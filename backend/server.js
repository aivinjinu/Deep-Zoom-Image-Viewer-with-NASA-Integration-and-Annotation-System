// Import required packages
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises; // Use the promise-based version of fs
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const crypto = require('crypto');

// Create an Express application
const app = express();
const PORT = 3000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

// --- File Paths ---
const dataPath = path.join(__dirname, 'data');
const imagesDbPath = path.join(__dirname, 'data', 'images.json');
const annotationsDbPath = path.join(__dirname, 'data', 'annotations.json');
const gigaImagesPath = path.join(__dirname, '../public/gigaimages');

// --- Directory and File Initialization on Server Start ---
(async () => {
    try {
        console.log('Initializing required directories and files...');
        await fs.mkdir(dataPath, { recursive: true });
        await fs.mkdir(gigaImagesPath, { recursive: true });
        console.log('Directories are ready.');
        try { await fs.access(imagesDbPath); } catch (error) {
            console.log('images.json not found, creating it...');
            await fs.writeFile(imagesDbPath, JSON.stringify([], null, 2), 'utf8');
        }
        try { await fs.access(annotationsDbPath); } catch (error) {
            console.log('annotations.json not found, creating it...');
            await fs.writeFile(annotationsDbPath, JSON.stringify({}, null, 2), 'utf8');
        }
        console.log('Initialization check complete.');
    } catch (error) {
        console.error('FATAL: Failed to initialize required directories or files:', error);
        process.exit(1);
    }
})();

// --- Middleware ---
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// --- Routes ---

app.get('/search', (req, res) => { res.sendFile(path.join(__dirname, '../public/search.html')); });

app.get('/api/images', async (req, res) => {
  console.log('Request received to list all processed images.');
  try {
    const dbData = await fs.readFile(imagesDbPath, 'utf8');
    const imageDb = JSON.parse(dbData);
    const directories = await fs.readdir(gigaImagesPath, { withFileTypes: true });
    const imageFolders = directories.filter(d => d.isDirectory()).map(d => d.name);
    const allImages = imageFolders.map(folderId => {
      const dbEntry = imageDb.find(img => img.id === folderId);
      return { id: folderId, name: dbEntry ? dbEntry.name : folderId, path: `gigaimages/${folderId}/tiles.dzi` };
    });
    console.log(`Found and listed ${allImages.length} images.`);
    res.json(allImages);
  } catch (error) {
    console.error('Error listing images:', error);
    res.status(500).send('Error listing images.');
  }
});

app.get('/api/nasa/asset-info/:nasa_id', async (req, res) => {
    const { nasa_id } = req.params;
    console.log(`[INFO] Fetching asset info for NASA ID: ${nasa_id}`);
    try {
        const assetUrl = `https://images-api.nasa.gov/asset/${nasa_id}`;
        const response = await axios.get(assetUrl);
        const items = response.data.collection.items;
        const highResItem = items.find(item => item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'));
        const largeItem = items.find(item => item.href.includes('~large.jpg'));
        const mediumItem = items.find(item => item.href.includes('~medium.jpg'));
        const firstJpgItem = items.find(item => item.href.toLowerCase().endsWith('.jpg'));
        const ordinaryUrl = largeItem?.href || mediumItem?.href || firstJpgItem?.href;
        if (!highResItem && !ordinaryUrl) { return res.status(404).send('No downloadable image assets found (JPG, TIF).'); }
        let highResSizeMB = null;
        if (highResItem) {
            try {
                const headResponse = await axios.head(highResItem.href);
                const contentLength = headResponse.headers['content-length'];
                if (contentLength) { highResSizeMB = Math.round(contentLength / (1024 * 1024)); }
            } catch (headError) { console.log(`[INFO] Could not fetch file size for ${highResItem.href}. Proceeding without it.`); }
        }
        res.json({ highResUrl: highResItem?.href || null, highResSizeMB: highResSizeMB, ordinaryUrl: ordinaryUrl || null });
    } catch (error) {
        console.error(`[INFO] Error fetching asset info for ${nasa_id}:`, error.response ? error.response.data : error.message);
        res.status(500).send('Failed to fetch asset information from NASA.');
    }
});

app.post('/api/process-nasa-image', async (req, res) => {
    // This endpoint remains unchanged and fully functional for the NASA search workflow
    const { nasa_id, title, imageUrl } = req.body;
    console.log(`\n--- New NASA Image Request ---`);
    console.log(`[INIT] Processing request for NASA ID: ${nasa_id} (Title: ${title})`);
    if (!nasa_id) { return res.status(400).send('NASA ID is required.'); }

    const imageId = crypto.createHash('md5').update(nasa_id).digest('hex');
    const imageFolderPath = path.join(gigaImagesPath, imageId);
    const dziPath = path.join(imageFolderPath, 'tiles.dzi');
    const relativeDziPath = `gigaimages/${imageId}/tiles.dzi`;

    try {
        await fs.access(dziPath);
        console.log(`[CACHE HIT] Image ${imageId} already processed. Serving from cache.`);
        return res.json({ id: imageId, path: relativeDziPath });
    } catch (e) { console.log(`[CACHE MISS] Image ${imageId} not found. Starting new processing workflow.`); }

    const tempImagePath = path.join(__dirname, 'data', `${imageId}_temp`);
    try {
        let finalImageUrl = imageUrl;
        if (!finalImageUrl) {
            console.log(`[API] No image URL provided by client, finding best available...`);
            const assetUrl = `https://images-api.nasa.gov/asset/${nasa_id}`;
            const assetResponse = await axios.get(assetUrl);
            const items = assetResponse.data.collection.items;
            const originalImageUrlItem = items.find(item => item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'));
            const largeImageUrlItem = items.find(item => item.href.includes('~large.jpg'));
            const firstJpgItem = items.find(item => item.href.toLowerCase().endsWith('.jpg'));
            finalImageUrl = originalImageUrlItem?.href || largeImageUrlItem?.href || firstJpgItem?.href;
        }
        if (!finalImageUrl) { throw new Error('Could not find a downloadable image URL.'); }
        console.log(`[API] Selected image URL for download: ${finalImageUrl}`);
        const writer = require('fs').createWriteStream(tempImagePath);
        const downloadResponse = await axios({ url: finalImageUrl, method: 'GET', responseType: 'stream' });
        downloadResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', () => { console.log('[DOWNLOAD] Download complete.'); resolve(); });
            writer.on('error', reject);
        });
        await fs.mkdir(imageFolderPath, { recursive: true });
        const vipsCommand = `vips dzsave "${tempImagePath}" "${path.join(imageFolderPath, 'tiles')}"`;
        console.log(`[VIPS] Executing command: ${vipsCommand}`);
        await new Promise((resolve, reject) => {
            exec(vipsCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[VIPS] Error: ${stderr}`);
                    return reject(new Error('Failed to process image with VIPS.'));
                }
                console.log(`[VIPS] Image processing complete for ${imageId}.`);
                resolve(stdout);
            });
        });
        console.log(`[DB] Updating images.json and annotations.json...`);
        const [imagesDbData, annotationsDbData] = await Promise.all([ fs.readFile(imagesDbPath, 'utf8'), fs.readFile(annotationsDbPath, 'utf8') ]);
        const imagesDb = JSON.parse(imagesDbData);
        const annotationsDb = JSON.parse(annotationsDbData);
        if (!imagesDb.find(img => img.id === imageId)) {
            imagesDb.push({ id: imageId, name: title, path: relativeDziPath, source: 'nasa' });
            if (!annotationsDb[imageId]) { annotationsDb[imageId] = []; }
        }
        await Promise.all([
            fs.writeFile(imagesDbPath, JSON.stringify(imagesDb, null, 2)),
            fs.writeFile(annotationsDbPath, JSON.stringify(annotationsDb, null, 2))
        ]);
        console.log(`[DB] Databases updated successfully.`);
        console.log(`[SUCCESS] Finished processing request for ${nasa_id}.`);
        res.status(201).json({ id: imageId, path: relativeDziPath });
    } catch (error) {
        console.error('Error during NASA image processing workflow:', error.message);
        await fs.rm(imageFolderPath, { recursive: true, force: true }).catch(() => {});
        res.status(500).send('Error processing NASA image.');
    } finally {
        await fs.unlink(tempImagePath).catch(() => {});
    }
});

// NEW: Endpoint to process an image from a direct URL with robust cleanup
app.post('/api/process-url', async (req, res) => {
    const { imageUrl } = req.body;
    console.log(`\n--- New URL Request ---`);
    console.log(`[INIT] Processing request for URL: ${imageUrl}`);

    if (!imageUrl) { return res.status(400).send('Image URL is required.'); }

    let imageId, title, tempImagePath, imageFolderPath, relativeDziPath;

    try {
        imageId = crypto.createHash('md5').update(imageUrl).digest('hex');
        const urlObj = new URL(imageUrl);
        title = path.basename(urlObj.pathname);
        imageFolderPath = path.join(gigaImagesPath, imageId);
        const dziPath = path.join(imageFolderPath, 'tiles.dzi');
        relativeDziPath = `gigaimages/${imageId}/tiles.dzi`;
        tempImagePath = path.join(__dirname, 'data', `${imageId}_temp${path.extname(title) || '.tmp'}`);
        
        await fs.access(dziPath);
        console.log(`[CACHE HIT] Image from URL ${imageUrl} already processed. Serving from cache.`);
        return res.json({ id: imageId, path: relativeDziPath });
    } catch (e) {
        if (e.code !== 'ENOENT') { // If error is not "file not found", it's a real issue.
            console.error("Error during initial setup:", e.message);
            return res.status(500).send("An unexpected error occurred.");
        }
        console.log(`[CACHE MISS] Image from URL not found. Starting new processing workflow.`);
    }

    try {
        // 1. Download the image
        console.log(`[DOWNLOAD] Starting download from ${imageUrl} to ${tempImagePath}...`);
        const writer = require('fs').createWriteStream(tempImagePath);
        const downloadResponse = await axios({ url: imageUrl, method: 'GET', responseType: 'stream' });
        downloadResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
            writer.on('finish', resolve);
            writer.on('error', reject);
        });
        console.log('[DOWNLOAD] Download complete.');

        // 2. Process with VIPS
        await fs.mkdir(imageFolderPath, { recursive: true });
        const vipsCommand = `vips dzsave "${tempImagePath}" "${path.join(imageFolderPath, 'tiles')}"`;
        console.log(`[VIPS] Executing command: ${vipsCommand}`);
        await new Promise((resolve, reject) => {
            exec(vipsCommand, (error, stdout, stderr) => {
                if (error) {
                    console.error(`[VIPS] Error: ${stderr}`);
                    return reject(new Error('Failed to process image with VIPS. Make sure VIPS is installed and in your PATH.'));
                }
                console.log(`[VIPS] Image processing complete.`);
                resolve(stdout);
            });
        });

        // 3. Update Databases
        console.log(`[DB] Updating databases...`);
        const [imagesDbData, annotationsDbData] = await Promise.all([ fs.readFile(imagesDbPath, 'utf8'), fs.readFile(annotationsDbPath, 'utf8') ]);
        const imagesDb = JSON.parse(imagesDbData);
        const annotationsDb = JSON.parse(annotationsDbData);
        if (!imagesDb.find(img => img.id === imageId)) {
            imagesDb.push({ id: imageId, name: title, path: relativeDziPath, source: 'url' });
            if (!annotationsDb[imageId]) { annotationsDb[imageId] = []; }
        }
        await Promise.all([
            fs.writeFile(imagesDbPath, JSON.stringify(imagesDb, null, 2)),
            fs.writeFile(annotationsDbPath, JSON.stringify(annotationsDb, null, 2))
        ]);
        console.log(`[DB] Databases updated.`);

        // 4. Final success response
        console.log(`[SUCCESS] Finished processing URL ${imageUrl}.`);
        res.status(201).json({ id: imageId, path: relativeDziPath });

    } catch (error) {
        console.error(`[ERROR] An error occurred during URL processing: ${error.message}`);
        console.log('[CLEANUP] Deleting temporary and processed files due to error...');
        // Clean up both the temp file and the output directory on any failure
        await Promise.allSettled([
            fs.unlink(tempImagePath),
            fs.rm(imageFolderPath, { recursive: true, force: true })
        ]);
        console.log('[CLEANUP] Cleanup complete.');
        return res.status(500).send(`Failed to process image from URL. Reason: ${error.message}`);
    } finally {
        // Ensure the temp file is always removed after processing finishes (success or fail)
        await fs.unlink(tempImagePath).catch(() => {});
    }
});

// Search NASA API
app.get('/api/nasa/search', async (req, res) => {
    const query = req.query.q;
    console.log(`Received NASA search request with query: "${query}"`);
    if (!query) { return res.status(400).send('Search query is required.'); }
    const highResQuery = `${query} HiRISE gigapan`;
    console.log(`Augmented search query for high-res: "${highResQuery}"`);

    try {
        const nasaApiUrl = `https://images-api.nasa.gov/search`;
        const response = await axios.get(nasaApiUrl, { params: { q: highResQuery, media_type: 'image' } });
        const results = response.data.collection.items.map(item => ({
            nasa_id: item.data[0].nasa_id,
            title: item.data[0].title,
            thumbnail: item.links ? item.links[0].href : null,
        })).filter(item => item.thumbnail);
        console.log(`Found ${results.length} results for query "${query}".`);
        res.json(results.slice(0, 50));
    } catch (error) {
        console.error('NASA API Search Error:', error.response ? error.response.data : error.message);
        res.status(500).send('Error searching NASA images.');
    }
});

// Annotation APIs
app.get('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;
    console.log(`Fetching annotations for image ID: ${imageId}`);
    try {
        const data = await fs.readFile(annotationsDbPath, 'utf8');
        const allAnnotations = JSON.parse(data);
        const imageAnnotations = allAnnotations[imageId] || [];
        res.json(imageAnnotations);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`No annotations file found for ${imageId}, returning empty array.`);
            return res.json([]);
        }
        console.error('Error reading annotations:', error);
        res.status(500).send('Error reading annotations.');
    }
});
app.post('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;
    console.log(`Saving new annotation for image ID: ${imageId}`);
    try {
        let allAnnotations = {};
        try {
            const data = await fs.readFile(annotationsDbPath, 'utf8');
            allAnnotations = JSON.parse(data);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            console.log('Annotations file not found, creating a new one.');
        }
        if (!allAnnotations[imageId]) {
            allAnnotations[imageId] = [];
        }
        allAnnotations[imageId].push(req.body);
        await fs.writeFile(annotationsDbPath, JSON.stringify(allAnnotations, null, 2));
        console.log(`Successfully saved annotation for ${imageId}.`);
        res.status(201).json(req.body);
    } catch (error) {
        console.error('Error saving annotation:', error);
        res.status(500).send('Error saving annotation.');
    }
});


// ... (all existing code from the previous step) ...

// NEW: Endpoint to delete an image
app.delete('/api/images/:id', async (req, res) => {
    const { id } = req.params;
    console.log(`\n--- Delete Image Request ---`);
    console.log(`[INIT] Deleting image with ID: ${id}`);

    const imageFolderPath = path.join(gigaImagesPath, id);

    try {
        // 1. Read the database files
        const [imagesDbData, annotationsDbData] = await Promise.all([
            fs.readFile(imagesDbPath, 'utf8'),
            fs.readFile(annotationsDbPath, 'utf8')
        ]);
        let imagesDb = JSON.parse(imagesDbData);
        let annotationsDb = JSON.parse(annotationsDbData);

        // 2. Update the databases in memory
        const imageIndex = imagesDb.findIndex(img => img.id === id);
        if (imageIndex === -1) {
            console.log(`[WARN] Image ID ${id} not found in images.json. Proceeding with file cleanup anyway.`);
        } else {
            imagesDb.splice(imageIndex, 1); // Remove from images array
            console.log(`[DB] Removed entry from images.json.`);
        }

        if (annotationsDb[id]) {
            delete annotationsDb[id]; // Remove from annotations object
            console.log(`[DB] Removed entry from annotations.json.`);
        }

        // 3. Write the updated databases back to disk
        await Promise.all([
            fs.writeFile(imagesDbPath, JSON.stringify(imagesDb, null, 2)),
            fs.writeFile(annotationsDbPath, JSON.stringify(annotationsDb, null, 2))
        ]);
        console.log(`[DB] Databases updated successfully.`);

        // 4. Delete the image folder from the filesystem
        console.log(`[FS] Deleting image folder: ${imageFolderPath}`);
        await fs.rm(imageFolderPath, { recursive: true, force: true });
        console.log(`[FS] Image folder deleted.`);

        console.log(`[SUCCESS] Successfully deleted image ${id}.`);
        res.status(200).json({ message: `Image ${id} deleted successfully.` });

    } catch (error) {
        console.error(`[ERROR] Failed to delete image ${id}:`, error.message);
        res.status(500).send(`Failed to delete image. Reason: ${error.message}`);
    }
});


// ... (the rest of the server.js file: search, annotations, app.listen, etc.)

// Start the server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});