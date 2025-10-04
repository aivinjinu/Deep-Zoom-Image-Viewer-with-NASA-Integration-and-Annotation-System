document.addEventListener('DOMContentLoaded', () => {
    if (!window.OpenSeadragon) { return console.error('OpenSeadragon library not found.'); }

    let currentImageId = null;
    let isPinningMode = false;
    let pins = [];
    let pinCounter = 0;
    let libraryImages = [];
    
    // --- Composition State ---
    let isCompositionMode = false;
    let activeCompositionItems = [];
    let draggedItem = null;
    let dragStartPosition = null;

    // --- DOM REFERENCES ---
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const imageSelector = document.getElementById('imageSelector');
    const deleteImageBtn = document.getElementById('deleteImageBtn');
    const addPinBtn = document.getElementById('addPinBtn');
    const pinsList = document.getElementById('pinsList');
    const annotationsPanel = document.getElementById('annotationsPanel');
    // Composition UI References
    const singleImageView = document.getElementById('singleImageView');
    const startCompositionBtn = document.getElementById('startCompositionBtn');
    const compositionWorkspace = document.getElementById('compositionWorkspace');
    const compositionImageList = document.getElementById('compositionImageList');
    const loadToCanvasBtn = document.getElementById('loadToCanvasBtn');
    const cancelCompositionBtn = document.getElementById('cancelCompositionBtn');
    const compositionTools = document.getElementById('compositionTools');
    const imageToolsContainer = document.getElementById('imageToolsContainer');
    // New Controls References
    const gapSlider = document.getElementById('gapSlider');
    const overlapCheckbox = document.getElementById('overlapCheckbox');
    
    // --- INITIALIZE VIEWER ---
    const viewer = OpenSeadragon({
        id: "openseadragon-viewer",
        prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
        showNavigator: true,
        collectionMode: true,
        gestureSettingsMouse: { clickToZoom: false },
    });

    // --- CORE FUNCTIONS (Single Image Mode) ---
    async function loadLibrary() {
        try {
            const response = await fetch('/api/images');
            libraryImages = await response.json();
            
            imageSelector.innerHTML = '';
            libraryImages.forEach(image => {
                const option = document.createElement('option');
                option.value = image.id;
                option.textContent = image.name;
                option.dataset.path = image.path;
                imageSelector.appendChild(option);
            });
            
            const urlParams = new URLSearchParams(window.location.search);
            const imageIdFromUrl = urlParams.get('image_id');
            if (imageIdFromUrl && libraryImages.some(img => img.id === imageIdFromUrl)) {
                imageSelector.value = imageIdFromUrl;
            }
            
            const selectedOption = imageSelector.options[imageSelector.selectedIndex];
            if (selectedOption) {
                switchImage(selectedOption.value, selectedOption.dataset.path);
            } else {
                currentImageId = null;
                viewer.close();
                loadAnnotations(null);
            }
        } catch (error) { console.error('Failed to load image library:', error); }
    }
    
    function switchImage(id, path) {
        if (currentImageId === id && !isCompositionMode) return;
        currentImageId = id;
        viewer.open(path);
        loadAnnotations(id);
        if (isPinningMode) resetPinningMode();
    }
    
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

    // --- COMPOSITION MODE FUNCTIONS ---
    function enterCompositionMode() {
        isCompositionMode = true;
        singleImageView.classList.add('hidden');
        compositionWorkspace.classList.remove('hidden');
        startCompositionBtn.classList.add('hidden');
        compositionTools.classList.add('hidden');
        annotationsPanel.classList.add('hidden');
        
        compositionImageList.innerHTML = '';
        if (libraryImages.length === 0) {
            compositionImageList.innerHTML = '<p style="padding: 10px;">Your library is empty.</p>';
            return;
        }
        libraryImages.forEach(image => {
            const item = document.createElement('label');
            item.className = 'composition-item';
            item.innerHTML = `<input type="checkbox" data-id="${image.id}" data-path="${image.path}" data-name="${image.name}"> ${image.name}`;
            compositionImageList.appendChild(item);
        });
    }

    function exitCompositionMode() {
        isCompositionMode = false;
        draggedItem = null;
        singleImageView.classList.remove('hidden');
        compositionWorkspace.classList.add('hidden');
        startCompositionBtn.classList.remove('hidden');
        compositionTools.classList.add('hidden');
        annotationsPanel.classList.remove('hidden');
        
        const selectedOption = imageSelector.options[imageSelector.selectedIndex];
        if (selectedOption) {
            switchImage(selectedOption.value, selectedOption.dataset.path);
        } else {
            viewer.close();
        }
    }

    function loadImagesToWorkspace() {
        const selectedCheckboxes = compositionImageList.querySelectorAll('input[type="checkbox"]:checked');
        if (selectedCheckboxes.length < 1) {
            alert('Please select at least one image.');
            return;
        }
        
        const isOverlapping = overlapCheckbox.checked;
        const gap = parseFloat(gapSlider.value);

        viewer.close();
        pinsList.innerHTML = '';
        activeCompositionItems = [];
        
        let offset = 0;
        selectedCheckboxes.forEach(checkbox => {
            const itemData = {
                id: checkbox.dataset.id,
                name: checkbox.dataset.name,
                path: checkbox.dataset.path
            };
            const currentOffset = isOverlapping ? 0 : offset * gap;

            viewer.addTiledImage({
                tileSource: itemData.path,
                x: currentOffset,
                y: currentOffset,
                opacity: 0.9,
                success: (event) => {
                    activeCompositionItems.push({ ...itemData, osdItem: event.item });
                    renderCompositionTools();
                }
            });
            offset++;
        });
        
        singleImageView.classList.add('hidden');
        compositionWorkspace.classList.add('hidden');
        startCompositionBtn.classList.remove('hidden');
        annotationsPanel.classList.add('hidden');
    }

    function renderCompositionTools() {
        imageToolsContainer.innerHTML = '';
        compositionTools.classList.remove('hidden');
        
        activeCompositionItems.forEach((item, index) => {
            const panel = document.createElement('div');
            panel.className = 'image-tool-panel';
            panel.innerHTML = `
                <p title="${item.name}">${item.name}</p>
                <label for="opacity-slider-${index}">Opacity:</label>
                <input type="range" id="opacity-slider-${index}" min="0" max="1" step="0.05" value="0.9">
            `;
            const slider = panel.querySelector('input[type="range"]');
            slider.addEventListener('input', (e) => {
                item.osdItem.setOpacity(parseFloat(e.target.value));
            });
            imageToolsContainer.appendChild(panel);
        });
    }

    // --- EVENT LISTENERS ---
    sidebarToggle.addEventListener('click', () => sidebar.classList.toggle('collapsed'));
    imageSelector.addEventListener('change', (e) => switchImage(e.target.value, e.target.options[e.target.selectedIndex].dataset.path));
    
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
            const response = await fetch(`/api/images/${imageId}`, { method: 'DELETE' });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Failed to delete the image from the server.');
            }
            await loadLibrary();
        } catch (error) {
            console.error('Deletion failed:', error);
            alert(`Could not delete the image: ${error.message}`);
        }
    });

    addPinBtn.addEventListener('click', () => {
        if (isCompositionMode) {
            alert('Annotations are disabled in Composition Mode.');
            return;
        }
        isPinningMode = !isPinningMode;
        addPinBtn.textContent = isPinningMode ? 'Click on image to place pin...' : '📍 Add Pin';
    });
    
    // Composition Mode Listeners
    startCompositionBtn.addEventListener('click', enterCompositionMode);
    cancelCompositionBtn.addEventListener('click', exitCompositionMode);
    loadToCanvasBtn.addEventListener('click', loadImagesToWorkspace);
    overlapCheckbox.addEventListener('change', () => {
        gapSlider.disabled = overlapCheckbox.checked;
    });

    // --- DRAG AND DROP & PINNING LOGIC ---
    viewer.addHandler('canvas-press', (event) => {
        if (isCompositionMode && viewer.world.getItemCount() > 0) {
            let bestItem = null;
            const pressPoint = viewer.viewport.pointFromPixel(event.position);
            for (let i = viewer.world.getItemCount() - 1; i >= 0; i--) {
                const item = viewer.world.getItemAt(i);
                const bounds = item.getBounds();
                if (pressPoint.x > bounds.x && pressPoint.x < bounds.x + bounds.width &&
                    pressPoint.y > bounds.y && pressPoint.y < bounds.y + bounds.height) {
                    bestItem = item;
                    break;
                }
            }
            if (bestItem) {
                draggedItem = bestItem;
                viewer.world.raiseToTop(draggedItem);
                const draggedData = activeCompositionItems.find(d => d.osdItem === draggedItem);
                if (draggedData) {
                    activeCompositionItems = activeCompositionItems.filter(d => d.osdItem !== draggedItem);
                    activeCompositionItems.push(draggedData);
                    renderCompositionTools();
                }
                dragStartPosition = viewer.viewport.pointFromPixel(event.position);
                const itemPosition = draggedItem.getBounds().getTopLeft();
                dragStartPosition.offset = pressPoint.minus(itemPosition);
            }
        }
    });

    viewer.addHandler('canvas-drag', (event) => {
        if (draggedItem && dragStartPosition) {
            const newMousePosition = viewer.viewport.pointFromPixel(event.position);
            draggedItem.setPosition(newMousePosition.minus(dragStartPosition.offset), true);
        }
    });

    viewer.addHandler('canvas-release', () => {
        draggedItem = null;
        dragStartPosition = null;
    });

    viewer.addHandler('canvas-click', (event) => {
        if (isCompositionMode || !isPinningMode) return;
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