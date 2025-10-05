document.addEventListener('DOMContentLoaded', () => {
    const unifiedSearchForm = document.getElementById('unifiedSearchForm');
    const unifiedSearchInput = document.getElementById('unifiedSearchInput');
    const resultsContainer = document.getElementById('results');

    // --- MAIN EVENT LISTENER ---

    unifiedSearchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = unifiedSearchInput.value.trim();
        if (!query) return;

        // Check if the input is a URL
        if (isUrl(query)) {
            await processDirectUrl(query);
        } else {
            await searchNasa(query);
        }
    });

    // --- API FUNCTIONS ---

    async function processDirectUrl(imageUrl) {
        displayStatus(`Processing image from URL. This may take a moment...`);
        try {
            const response = await fetch('/api/process-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl }),
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const processedImage = await response.json();
            window.location.href = `/?image_id=${processedImage.id}`;
        } catch (error) {
            displayError(error.message, true);
        }
    }

    async function searchNasa(query) {
        displayStatus('Searching NASA for images...');
        try {
            const response = await fetch(`/api/nasa/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) {
                throw new Error(`Search failed: ${await response.text()}`);
            }
            const results = await response.json();
            displayNasaResults(results);
        } catch (error) {
            displayError(error.message);
        }
    }

    // Listener for NASA search result clicks (delegated to results container)
    resultsContainer.addEventListener('click', async (e) => {
        const clickedItem = e.target.closest('.nasa-item');
        if (!clickedItem) return;

        const nasaId = clickedItem.dataset.nasaId;
        const title = clickedItem.dataset.title;

        try {
            displayStatus(`Checking resolutions for: <strong>${title}</strong>...`);
            const infoResponse = await fetch(`/api/nasa/asset-info/${nasaId}`);
            if (!infoResponse.ok) throw new Error('Could not get image info.');

            const assetInfo = await infoResponse.json();
            let urlToProcess = assetInfo.highResUrl || assetInfo.ordinaryUrl;

            if (!urlToProcess) throw new Error('No downloadable image version found.');
            
            displayStatus(`Processing: <strong>${title}</strong>. This may take a moment...`);
            const processResponse = await fetch('/api/process-nasa-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nasa_id: nasaId, title: title, imageUrl: urlToProcess }),
            });

            if (!processResponse.ok) {
                throw new Error(`Could not process image. Server said: ${await processResponse.text()}`);
            }
            const processedImage = await processResponse.json();
            window.location.href = `/?image_id=${processedImage.id}`;
        } catch (error) {
            displayError(error.message, true);
        }
    });

    // --- HELPER & DISPLAY FUNCTIONS ---

    function isUrl(str) {
        try {
            new URL(str);
            return true;
        } catch (_) {
            return false;
        }
    }

    function displayNasaResults(items) {
        resultsContainer.innerHTML = '';
        if (items.length === 0) {
            displayStatus('No results found for your query.');
            return;
        }
        items.forEach(item => {
            const resultItem = document.createElement('div');
            resultItem.className = 'nasa-item';
            resultItem.dataset.nasaId = item.nasa_id;
            resultItem.dataset.title = item.title;
            resultItem.innerHTML = `<img src="${item.thumbnail}" alt="${item.title}" onerror="this.style.display='none'"><span class="nasa-item-title">${item.title}</span>`;
            resultsContainer.appendChild(resultItem);
        });
    }

    function displayStatus(message) { resultsContainer.innerHTML = `<p>${message}</p>`; }

    function displayError(message, showHelpText = false) {
        let helpText = showHelpText ? '<p>Please check the URL or try a different search term.</p>' : '';
        resultsContainer.innerHTML = `<p class="error">${message}</p>${helpText}`;
    }
});
