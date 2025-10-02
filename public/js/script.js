document.addEventListener('DOMContentLoaded', () => {
    if (!window.OpenSeadragon) {
        return console.error('OpenSeadragon library not found.');
    }

    let currentImageId = null;
    let isPinningMode = false;
    let pins = [];
    let pinCounter = 0;

    // --- DOM REFERENCES ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const imageSelector = document.getElementById('imageSelector');
    const deleteImageBtn = document.getElementById('deleteImageBtn'); // New reference
    const addPinBtn = document.getElementById('addPinBtn');
    const pinsList = document.getElementById('pinsList');
    
    // --- INITIALIZE VIEWER ---
    const viewer = OpenSeadragon({
        id: "openseadragon-viewer",
        prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
        showNavigator: true,
    });

    // --- CORE FUNCTIONS ---

    // Fetches all images from the backend and populates the dropdown
    async function loadLibrary() {
        try {
            const response = await fetch('/api/images');
            const images = await response.json();
            
            imageSelector.innerHTML = ''; // Clear previous options
            images.forEach(image => {
                const option = document.createElement('option');
                option.value = image.id;
                option.textContent = image.name;
                option.dataset.path = image.path;
                imageSelector.appendChild(option);
            });
            
            const urlParams = new URLSearchParams(window.location.search);
            const imageIdFromUrl = urlParams.get('image_id');
            
            if (imageIdFromUrl && images.some(img => img.id === imageIdFromUrl)) {
                imageSelector.value = imageIdFromUrl;
            }
            
            const selectedOption = imageSelector.options[imageSelector.selectedIndex];
            // UPDATED: Handle case where no images are left
            if (selectedOption) {
                switchImage(selectedOption.value, selectedOption.dataset.path);
            } else {
                // If the library is empty, clear the viewer.
                currentImageId = null;
                viewer.close();
                loadAnnotations(null);
            }

        } catch (error) { console.error('Failed to load image library:', error); }
    }
    
    // Opens a new image in the viewer and loads its annotations
    function switchImage(id, path) {
        if (currentImageId === id) return; // Don't reload the same image
        currentImageId = id;
        viewer.open(path);
        loadAnnotations(id);
        if (isPinningMode) resetPinningMode();
    }
    
    // Fetches and displays annotations for the current image
    async function loadAnnotations(imageId) {
        pinsList.innerHTML = '';
        viewer.clearOverlays();
        pins = [];
        pinCounter = 0;

        if (!imageId) return;

        try {
            const response = await fetch(`/api/images/${imageId}/annotations`);
            if (!response.ok) { return; }
            pins = await response.json();
            pinCounter = pins.length;
            pins.forEach(renderPin);
        } catch (error) { console.error('Failed to load annotations:', error); }
    }
    
    function renderPin(pin) {
        const pinElement = document.createElement('div');
        pinElement.id = pin.id;
        pinElement.className = 'pin-marker';
        viewer.addOverlay({ element: pinElement, location: new OpenSeadragon.Point(pin.point.x, pin.point.y), placement: 'CENTER' });

        const listItem = document.createElement('li');
        listItem.textContent = pin.text;
        listItem.dataset.pinId = pin.id;
        pinsList.appendChild(listItem);

        listItem.addEventListener('click', () => {
            viewer.viewport.panTo(pin.point, false);
            viewer.viewport.zoomTo(viewer.viewport.getMaxZoom(), pin.point, false);
        });
    }

    async function savePin(imageId, pin) {
        try {
            const response = await fetch(`/api/images/${imageId}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pin),
            });
            const savedPin = await response.json();
            pins.push(savedPin);
            renderPin(savedPin);
        } catch (error) { console.error('Failed to save pin:', error); }
    }

    function resetPinningMode() {
        isPinningMode = false;
        addPinBtn.textContent = '📍 Add Pin';
    }

    // --- EVENT LISTENERS ---
    
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));

    imageSelector.addEventListener('change', (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        switchImage(selectedOption.value, selectedOption.dataset.path);
    });

    // NEW: Event listener for the delete button
    deleteImageBtn.addEventListener('click', async () => {
        const selectedOption = imageSelector.options[imageSelector.selectedIndex];
        if (!selectedOption) {
            alert('No image selected to delete.');
            return;
        }

        const imageId = selectedOption.value;
        const imageName = selectedOption.textContent;

        if (!confirm(`Are you sure you want to permanently delete "${imageName}"?\nThis action cannot be undone.`)) {
            return;
        }

        try {
            const response = await fetch(`/api/images/${imageId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to delete the image from the server.');
            }
            
            // Reload the library to reflect the change. This will remove the item
            // from the dropdown and load the next available image.
            await loadLibrary();

        } catch (error) {
            console.error('Deletion failed:', error);
            alert(`Could not delete the image: ${error.message}`);
        }
    });

    addPinBtn.addEventListener('click', () => {
        isPinningMode = !isPinningMode;
        if (isPinningMode) {
            addPinBtn.textContent = 'Click on image to place pin...';
        } else {
            resetPinningMode();
        }
    });

    viewer.addHandler('canvas-click', (event) => {
        if (!isPinningMode) return;
        const viewportPoint = viewer.viewport.pointFromPixel(event.position);
        pinCounter++;
        const newPin = {
            id: `pin-${Date.now()}`,
            text: `Annotation #${pinCounter}`,
            point: { x: viewportPoint.x, y: viewportPoint.y }
        };
        savePin(currentImageId, newPin);
        resetPinningMode();
    });

    // --- INITIAL LOAD ---
    loadLibrary();
});