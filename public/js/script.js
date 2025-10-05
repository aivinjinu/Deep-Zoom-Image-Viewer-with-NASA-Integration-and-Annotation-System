document.addEventListener('DOMContentLoaded', () => {
    if (!window.OpenSeadragon) {
        console.error('OpenSeadragon library not found.');
        alert('Critical error: OpenSeadragon library not loaded. Please refresh the page.');
        return;
    }

    let currentImageId = null;
    let isPinningMode = false;
    let pins = [];
    let pinCounter = 0;
    let isLoading = false;

    // --- DOM REFERENCES ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const imageSelector = document.getElementById('imageSelector');
    const deleteImageBtn = document.getElementById('deleteImageBtn');
    const addPinBtn = document.getElementById('addPinBtn');
    const pinsList = document.getElementById('pinsList');
    
    // Validate DOM elements
    if (!sidebar || !sidebarToggle || !imageSelector || !deleteImageBtn || !addPinBtn || !pinsList) {
        console.error('Critical DOM elements missing');
        alert('Application error: Required elements not found. Please refresh the page.');
        return;
    }

    // --- INITIALIZE VIEWER ---
    let viewer;
    try {
        viewer = OpenSeadragon({
            id: "openseadragon-viewer",
            prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
            showNavigator: true,
            showNavigationControl: true,
            animationTime: 0.5,
            blendTime: 0.1,
            constrainDuringPan: false,
            maxZoomPixelRatio: 2,
            minZoomLevel: 0.8,
            visibilityRatio: 1,
            zoomPerScroll: 2
        });
    } catch (error) {
        console.error('Failed to initialize OpenSeadragon viewer:', error);
        alert('Failed to initialize image viewer. Please refresh the page.');
        return;
    }

    // --- CORE FUNCTIONS ---

    // Fetches all images from the backend and populates the dropdown
    async function loadLibrary() {
        if (isLoading) {
            console.log('Library load already in progress, skipping...');
            return;
        }

        isLoading = true;
        try {
            console.log('Loading image library...');
            const response = await fetch('/api/images');
            
            if (!response.ok) {
                throw new Error(`Server returned ${response.status}: ${response.statusText}`);
            }
            
            const images = await response.json();
            
            if (!Array.isArray(images)) {
                throw new Error('Invalid response format from server');
            }
            
            // Clear previous options
            imageSelector.innerHTML = '';
            
            // Populate dropdown
            images.forEach(image => {
                if (!image.id || !image.name || !image.path) {
                    console.warn('Skipping invalid image entry:', image);
                    return;
                }
                const option = document.createElement('option');
                option.value = image.id;
                option.textContent = image.name;
                option.dataset.path = image.path;
                imageSelector.appendChild(option);
            });
            
            console.log(`Loaded ${images.length} images into library`);
            
            // Handle URL parameter for specific image
            const urlParams = new URLSearchParams(window.location.search);
            const imageIdFromUrl = urlParams.get('image_id');
            
            if (imageIdFromUrl && images.some(img => img.id === imageIdFromUrl)) {
                imageSelector.value = imageIdFromUrl;
                console.log(`Selecting image from URL: ${imageIdFromUrl}`);
            }
            
            // Load the selected or first image
            const selectedOption = imageSelector.options[imageSelector.selectedIndex];
            if (selectedOption) {
                switchImage(selectedOption.value, selectedOption.dataset.path);
                deleteImageBtn.disabled = false;
            } else {
                // Library is empty
                console.log('No images in library');
                currentImageId = null;
                viewer.close();
                loadAnnotations(null);
                deleteImageBtn.disabled = true;
                addPinBtn.disabled = true;
            }

        } catch (error) {
            console.error('Failed to load image library:', error);
            alert(`Failed to load image library: ${error.message}`);
            deleteImageBtn.disabled = true;
            addPinBtn.disabled = true;
        } finally {
            isLoading = false;
        }
    }
    
    // Opens a new image in the viewer and loads its annotations
    function switchImage(id, path) {
        if (!id || !path) {
            console.error('Invalid image parameters:', { id, path });
            return;
        }

        if (currentImageId === id) {
            console.log('Image already loaded, skipping switch');
            return;
        }

        try {
            console.log(`Switching to image: ${id}`);
            currentImageId = id;
            viewer.open(path);
            loadAnnotations(id);
            
            if (isPinningMode) {
                resetPinningMode();
            }

            addPinBtn.disabled = false;
            deleteImageBtn.disabled = false;

            // Update URL without page reload
            const newUrl = new URL(window.location);
            newUrl.searchParams.set('image_id', id);
            window.history.replaceState({}, '', newUrl);

        } catch (error) {
            console.error('Failed to switch image:', error);
            alert(`Failed to load image: ${error.message}`);
        }
    }
    
    // Fetches and displays annotations for the current image
    async function loadAnnotations(imageId) {
        // Clear existing annotations
        pinsList.innerHTML = '';
        viewer.clearOverlays();
        pins = [];
        pinCounter = 0;

        if (!imageId) {
            console.log('No image ID provided, skipping annotation load');
            return;
        }

        try {
            console.log(`Loading annotations for image: ${imageId}`);
            const response = await fetch(`/api/images/${imageId}/annotations`);
            
            if (!response.ok) {
                if (response.status === 404) {
                    console.log('No annotations found for this image');
                    return;
                }
                throw new Error(`Server returned ${response.status}`);
            }
            
            const loadedPins = await response.json();
            
            if (!Array.isArray(loadedPins)) {
                throw new Error('Invalid annotations format');
            }

            pins = loadedPins;
            pinCounter = pins.length;
            
            pins.forEach(pin => {
                if (validatePin(pin)) {
                    renderPin(pin);
                } else {
                    console.warn('Skipping invalid pin:', pin);
                }
            });

            console.log(`Loaded ${pins.length} annotations`);

        } catch (error) {
            console.error('Failed to load annotations:', error);
            // Don't alert for annotation load failures - not critical
        }
    }

    // Validates pin structure
    function validatePin(pin) {
        return pin && 
               pin.id && 
               pin.text && 
               pin.point && 
               typeof pin.point.x === 'number' && 
               typeof pin.point.y === 'number';
    }
    
    // Renders a pin on the viewer and in the list
    function renderPin(pin) {
        try {
            // Create pin marker on viewer
            const pinElement = document.createElement('div');
            pinElement.id = pin.id;
            pinElement.className = 'pin-marker';
            pinElement.title = pin.text;
            
            viewer.addOverlay({
                element: pinElement,
                location: new OpenSeadragon.Point(pin.point.x, pin.point.y),
                placement: OpenSeadragon.Placement.CENTER
            });

            // Create list item
            const listItem = document.createElement('li');
            listItem.textContent = pin.text;
            listItem.dataset.pinId = pin.id;
            listItem.title = 'Click to navigate to this pin';
            pinsList.appendChild(listItem);

            // Navigate to pin on click
            listItem.addEventListener('click', () => {
                try {
                    const point = new OpenSeadragon.Point(pin.point.x, pin.point.y);
                    viewer.viewport.panTo(point, false);
                    viewer.viewport.zoomTo(viewer.viewport.getMaxZoom() * 0.8, point, false);
                } catch (error) {
                    console.error('Failed to navigate to pin:', error);
                }
            });

        } catch (error) {
            console.error('Failed to render pin:', error);
        }
    }

    // Saves a new pin to the server
    async function savePin(imageId, pin) {
        if (!imageId || !validatePin(pin)) {
            console.error('Invalid pin data:', { imageId, pin });
            return;
        }

        try {
            console.log(`Saving pin for image: ${imageId}`);
            const response = await fetch(`/api/images/${imageId}/annotations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pin),
            });

            if (!response.ok) {
                throw new Error(`Server returned ${response.status}`);
            }

            const savedPin = await response.json();
            pins.push(savedPin);
            renderPin(savedPin);
            console.log('Pin saved successfully');

        } catch (error) {
            console.error('Failed to save pin:', error);
            alert(`Failed to save annotation: ${error.message}`);
        }
    }

    // Resets pinning mode
    function resetPinningMode() {
        isPinningMode = false;
        addPinBtn.textContent = '📍 Add Pin';
        addPinBtn.style.backgroundColor = '';
    }

    // --- EVENT LISTENERS ---
    
    // Toggle sidebar
    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('collapsed');
    });

    // Change selected image
    imageSelector.addEventListener('change', (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        if (selectedOption) {
            switchImage(selectedOption.value, selectedOption.dataset.path);
        }
    });

    // Delete image button
    deleteImageBtn.addEventListener('click', async () => {
        const selectedOption = imageSelector.options[imageSelector.selectedIndex];
        
        if (!selectedOption) {
            alert('No image selected to delete.');
            return;
        }

        const imageId = selectedOption.value;
        const imageName = selectedOption.textContent;

        const confirmed = confirm(
            `Are you sure you want to permanently delete "${imageName}"?\n\n` +
            `This will remove:\n` +
            `• The image and all its tiles\n` +
            `• All annotations for this image\n\n` +
            `This action cannot be undone.`
        );

        if (!confirmed) {
            return;
        }

        // Disable button to prevent double-clicks
        deleteImageBtn.disabled = true;
        const originalText = deleteImageBtn.textContent;
        deleteImageBtn.textContent = '⏳';

        try {
            console.log(`Deleting image: ${imageId}`);
            const response = await fetch(`/api/images/${imageId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to delete the image from the server.');
            }
            
            console.log('Image deleted successfully');
            
            // Reload the library to reflect the change
            await loadLibrary();

        } catch (error) {
            console.error('Deletion failed:', error);
            alert(`Could not delete the image: ${error.message}`);
            deleteImageBtn.disabled = false;
            deleteImageBtn.textContent = originalText;
        }
    });

    // Add pin button
    addPinBtn.addEventListener('click', () => {
        if (!currentImageId) {
            alert('Please select an image first.');
            return;
        }

        isPinningMode = !isPinningMode;
        
        if (isPinningMode) {
            addPinBtn.textContent = '📍 Click on image to place pin...';
            addPinBtn.style.backgroundColor = '#ffa500';
        } else {
            resetPinningMode();
        }
    });

    // Canvas click handler for placing pins
    viewer.addHandler('canvas-click', (event) => {
        if (!isPinningMode || !currentImageId) {
            return;
        }

        try {
            const viewportPoint = viewer.viewport.pointFromPixel(event.position);
            pinCounter++;
            
            const newPin = {
                id: `pin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                text: `Annotation #${pinCounter}`,
                point: { 
                    x: viewportPoint.x, 
                    y: viewportPoint.y 
                }
            };
            
            savePin(currentImageId, newPin);
            resetPinningMode();

        } catch (error) {
            console.error('Failed to create pin:', error);
            alert('Failed to create annotation. Please try again.');
        }
    });

    // Handle viewer errors
    viewer.addHandler('open-failed', (event) => {
        console.error('Failed to open image:', event);
        alert('Failed to load the selected image. The file may be corrupted or missing.');
    });

    // --- INITIAL LOAD ---
    console.log('Initializing application...');
    loadLibrary();
});