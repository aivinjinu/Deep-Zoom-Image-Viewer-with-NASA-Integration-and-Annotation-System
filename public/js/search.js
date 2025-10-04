document.addEventListener('DOMContentLoaded', () => {
    const searchForm = document.getElementById('nasaSearchForm');
    const searchInput = document.getElementById('nasaSearchInput');
    const resultsContainer = document.getElementById('nasaResults');
    const directDownloadForm = document.getElementById('directDownloadForm');
    const imageUrlInput = document.getElementById('imageUrlInput');
    const imgUrlError = document.getElementById('imgUrlError'); // NEW


    // --- EVENT LISTENERS ---

    // Listener for NASA Search
    searchForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const query = searchInput.value.trim();
        if (!query) return;
        displayStatus('Searching for images...');
        try {
            const response = await fetch(`/api/nasa/search?q=${encodeURIComponent(query)}`);
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Search failed: ${errorText}`);
            }
            const results = await response.json();
            displayResults(results);
        } catch (error) {
            displayError(error.message);
        }
    });

    // Listener for NASA search result clicks
    resultsContainer.addEventListener('click', async (e) => {
        const clickedItem = e.target.closest('.nasa-item');
        if (!clickedItem) return;

        const nasaId = clickedItem.dataset.nasaId;
        const title = clickedItem.dataset.title;

        try {
            displayStatus(`Checking resolutions for: <strong>${title}</strong>...`);
            const infoResponse = await fetch(`/api/nasa/asset-info/${nasaId}`);
            if (!infoResponse.ok) {
                throw new Error('Could not retrieve image information from server.');
            }
            const assetInfo = await infoResponse.json();

            let urlToProcess = null;

            if (assetInfo.highResUrl) {
                let confirmMessage = 'A high-resolution version is available.';
                if (assetInfo.highResSizeMB) {
                    const fileExtension = assetInfo.highResUrl.split('.').pop().toUpperCase();
                    confirmMessage = `A high-resolution version is available (${fileExtension}, approx. ${assetInfo.highResSizeMB} MB).`;
                }
                confirmMessage += '\n\nThis file may be very large and take longer to process.\n\nDo you want to download the high-resolution version?';
                const useHighRes = confirm(confirmMessage);
                if (useHighRes) {
                    urlToProcess = assetInfo.highResUrl;
                } else {
                    urlToProcess = assetInfo.ordinaryUrl;
                    if (!urlToProcess) {
                        alert('Proceeding with the high-resolution version as it is the only one available.');
                        urlToProcess = assetInfo.highResUrl;
                    }
                }
            } else if (assetInfo.ordinaryUrl) {
                urlToProcess = assetInfo.ordinaryUrl;
            } else {
                throw new Error('No downloadable image versions were found for this asset.');
            }
            
            displayStatus(`Processing: <strong>${title}</strong>. This may take a moment...`);
            const processResponse = await fetch('/api/process-nasa-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nasa_id: nasaId, title: title, imageUrl: urlToProcess }),
            });

            if (!processResponse.ok) {
                const errorData = await processResponse.text();
                throw new Error(`Could not process image. Server said: ${errorData}`);
            }
            const processedImage = await processResponse.json();
            window.location.href = `/?image_id=${processedImage.id}`;
        } catch (error) {
            displayError(error.message, true);
        }
    });
    
    // NEW: Listener for Direct URL Submission
    directDownloadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const imageUrl = imageUrlInput.value.trim();
        if (!imageUrl) return;

        displayStatus(`Processing image from URL. This may take a moment...`);

        try {
            const response = await fetch('/api/process-url', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl }),
            });

            if (!response.ok) {
                // The server should send back a plain text error message
                const errorText = await response.text();
                throw new Error(errorText);
            }

            const processedImage = await response.json();
            window.location.href = `/?image_id=${processedImage.id}`;
        } catch (error) {
            displayError(error.message, true);
        }
    });

    // --- HELPER FUNCTIONS ---
    function displayResults(items) {
        resultsContainer.innerHTML = '';
        if (items.length === 0) { displayStatus('No results found for your query.'); return; }
        items.forEach(item => {
            const resultItem = document.createElement('div');
            resultItem.className = 'nasa-item';
            resultItem.dataset.nasaId = item.nasa_id;
            resultItem.dataset.title = item.title;
            resultItem.innerHTML = `<img src="${item.thumbnail}" alt="${item.title}"><span class="nasa-item-title">${item.title}</span>`;
            resultsContainer.appendChild(resultItem);
        });
    }

    function displayStatus(message) { resultsContainer.innerHTML = `<p>${message}</p>`; }

    function displayError(message, showHelpText = false) {
        let helpText = showHelpText ? '<p>Please try another search or select a different image.</p>' : '';
        resultsContainer.innerHTML = `<p class="error">${message}</p>${helpText}`;
    }



    // NEW: Listener for Direct URL Submission
directDownloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    imgUrlError.textContent = '';
    const imageUrl = imageUrlInput.value.trim();
    if (!imageUrl) return;

    // Optional: Warn user if .IMG file
    if (imageUrl.toLowerCase().endsWith('.img')) {
        imgUrlError.textContent = "Processing .IMG files may take longer. Only PDS-format .IMG files are supported.";
    }

    displayStatus(`Processing image from URL. This may take a moment...`);

    try {
        const response = await fetch('/api/process-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            imgUrlError.textContent = errorText;
            displayError(errorText, true);
            return;
        }

        const processedImage = await response.json();
        window.location.href = `/?image_id=${processedImage.id}`;
    } catch (error) {
        imgUrlError.textContent = error.message;
        displayError(error.message, true);
    }
});
});