// Import required packages
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const { exec } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');

const execAsync = promisify(exec);

// Create an Express application
const app = express();
const PORT = process.env.PORT || 3000;
const NASA_API_KEY = process.env.NASA_API_KEY || 'DEMO_KEY';

// --- Configuration ---
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 255;
const MAX_ANNOTATION_LENGTH = 500;
const ALLOWED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.gif', '.bmp'];
const REQUEST_TIMEOUT = 300000; // 5 minutes for large file processing

// --- File Paths ---
const dataPath = path.join(__dirname, 'data');
const imagesDbPath = path.join(__dirname, 'data', 'images.json');
const annotationsDbPath = path.join(__dirname, 'data', 'annotations.json');
const gigaImagesPath = path.join(__dirname, '../public/gigaimages');

// --- Utility Functions ---

// Safely read JSON file with error handling
async function readJsonFile(filePath, defaultValue = null) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            console.log(`File not found: ${filePath}, using default value`);
            return defaultValue;
        }
        console.error(`Error reading ${filePath}:`, error);
        throw error;
    }
}

// Safely write JSON file with atomic write
async function writeJsonFile(filePath, data) {
    const tempPath = `${filePath}.tmp`;
    try {
        await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
        await fs.rename(tempPath, filePath);
    } catch (error) {
        // Clean up temp file if it exists
        await fs.unlink(tempPath).catch(() => {});
        throw error;
    }
}

// Validate URL
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (error) {
        return false;
    }
}

// Validate image extension
function hasValidImageExtension(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ALLOWED_IMAGE_EXTENSIONS.includes(ext);
}

// Sanitize filename
function sanitizeFilename(filename) {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, MAX_TITLE_LENGTH);
}

// Clean up temporary files
async function cleanupTempFile(filePath) {
    try {
        await fs.unlink(filePath);
        console.log(`Cleaned up temp file: ${filePath}`);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.warn(`Failed to cleanup temp file ${filePath}:`, error.message);
        }
    }
}

// Check if VIPS is installed
async function checkVipsInstalled() {
    try {
        await execAsync('vips --version');
        return true;
    } catch (error) {
        return false;
    }
}

// --- Directory and File Initialization on Server Start ---
(async () => {
    try {
        console.log('=== Server Initialization ===');
        
        // Check for VIPS
        const vipsInstalled = await checkVipsInstalled();
        if (!vipsInstalled) {
            console.warn('WARNING: VIPS is not installed or not in PATH. Image processing will fail.');
            console.warn('Please install VIPS: https://www.libvips.org/install.html');
        } else {
            console.log('✓ VIPS is installed');
        }

        // Create directories
        console.log('Creating required directories...');
        await fs.mkdir(dataPath, { recursive: true });
        await fs.mkdir(gigaImagesPath, { recursive: true });
        console.log('✓ Directories created');

        // Initialize database files
        console.log('Checking database files...');
        
        const imagesDb = await readJsonFile(imagesDbPath, []);
        if (imagesDb === null || !Array.isArray(imagesDb)) {
            console.log('Initializing images.json...');
            await writeJsonFile(imagesDbPath, []);
        }
        console.log('✓ images.json ready');

        const annotationsDb = await readJsonFile(annotationsDbPath, {});
        if (annotationsDb === null || typeof annotationsDb !== 'object') {
            console.log('Initializing annotations.json...');
            await writeJsonFile(annotationsDbPath, {});
        }
        console.log('✓ annotations.json ready');

        console.log('=== Initialization Complete ===\n');
    } catch (error) {
        console.error('FATAL: Failed to initialize server:', error);
        process.exit(1);
    }
})();

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
    next();
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).send('Internal server error');
});

// --- Routes ---

// Serve search page
app.get('/search', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/search.html'));
});

// Get all images
app.get('/api/images', async (req, res) => {
    try {
        const imageDb = await readJsonFile(imagesDbPath, []);
        const directories = await fs.readdir(gigaImagesPath, { withFileTypes: true });
        const imageFolders = directories.filter(d => d.isDirectory()).map(d => d.name);
        
        const allImages = imageFolders
            .map(folderId => {
                const dbEntry = imageDb.find(img => img.id === folderId);
                return {
                    id: folderId,
                    name: dbEntry ? dbEntry.name : folderId,
                    path: `gigaimages/${folderId}/tiles.dzi`
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        console.log(`Listed ${allImages.length} images`);
        res.json(allImages);
    } catch (error) {
        console.error('Error listing images:', error);
        res.status(500).send('Failed to list images');
    }
});

// Get NASA asset information
app.get('/api/nasa/asset-info/:nasa_id', async (req, res) => {
    const { nasa_id } = req.params;

    if (!nasa_id || nasa_id.length > 100) {
        return res.status(400).send('Invalid NASA ID');
    }

    console.log(`Fetching asset info for NASA ID: ${nasa_id}`);

    try {
        const assetUrl = `https://images-api.nasa.gov/asset/${encodeURIComponent(nasa_id)}`;
        const response = await axios.get(assetUrl, { timeout: 10000 });

        if (!response.data || !response.data.collection || !response.data.collection.items) {
            return res.status(404).send('No assets found for this NASA ID');
        }

        const items = response.data.collection.items;

        // Find different resolution options
        const highResItem = items.find(item => 
            item.href && (item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'))
        );
        const largeItem = items.find(item => item.href && item.href.includes('~large.jpg'));
        const mediumItem = items.find(item => item.href && item.href.includes('~medium.jpg'));
        const firstJpgItem = items.find(item => item.href && item.href.toLowerCase().endsWith('.jpg'));

        const ordinaryUrl = largeItem?.href || mediumItem?.href || firstJpgItem?.href;

        if (!highResItem && !ordinaryUrl) {
            return res.status(404).send('No downloadable image assets found');
        }

        // Try to get file size for high-res image
        let highResSizeMB = null;
        if (highResItem) {
            try {
                const headResponse = await axios.head(highResItem.href, { timeout: 5000 });
                const contentLength = headResponse.headers['content-length'];
                if (contentLength) {
                    highResSizeMB = Math.round(contentLength / (1024 * 1024));
                }
            } catch (headError) {
                console.log(`Could not fetch file size for ${highResItem.href}`);
            }
        }

        res.json({
            highResUrl: highResItem?.href || null,
            highResSizeMB: highResSizeMB,
            ordinaryUrl: ordinaryUrl || null
        });

    } catch (error) {
        console.error(`Error fetching asset info for ${nasa_id}:`, error.message);
        if (error.response) {
            res.status(error.response.status).send('Failed to fetch asset information from NASA');
        } else {
            res.status(500).send('Failed to fetch asset information');
        }
    }
});

// Process NASA image
app.post('/api/process-nasa-image', async (req, res) => {
    const { nasa_id, title, imageUrl } = req.body;

    console.log(`\n=== NASA Image Processing Request ===`);
    console.log(`NASA ID: ${nasa_id}`);
    console.log(`Title: ${title}`);

    // Validate inputs
    if (!nasa_id || typeof nasa_id !== 'string' || nasa_id.length > 100) {
        return res.status(400).send('Invalid NASA ID');
    }

    if (!title || typeof title !== 'string' || title.length > MAX_TITLE_LENGTH) {
        return res.status(400).send('Invalid or missing title');
    }

    if (imageUrl && !isValidUrl(imageUrl)) {
        return res.status(400).send('Invalid image URL');
    }

    const imageId = crypto.createHash('md5').update(nasa_id).digest('hex');
    const imageFolderPath = path.join(gigaImagesPath, imageId);
    const dziPath = path.join(imageFolderPath, 'tiles.dzi');
    const relativeDziPath = `gigaimages/${imageId}/tiles.dzi`;
    const tempImagePath = path.join(dataPath, `${imageId}_temp`);

    try {
        // Check if already processed
        try {
            await fs.access(dziPath);
            console.log(`✓ Image already processed, serving from cache`);
            return res.json({ id: imageId, path: relativeDziPath });
        } catch (e) {
            console.log(`Processing new image...`);
        }

        // Find image URL if not provided
        let finalImageUrl = imageUrl;
        if (!finalImageUrl) {
            console.log(`Finding best available image URL...`);
            const assetUrl = `https://images-api.nasa.gov/asset/${encodeURIComponent(nasa_id)}`;
            const assetResponse = await axios.get(assetUrl, { timeout: 10000 });
            const items = assetResponse.data.collection.items;

            const originalImageUrlItem = items.find(item => 
                item.href && (item.href.includes('~orig.tif') || item.href.includes('~orig.jpg'))
            );
            const largeImageUrlItem = items.find(item => item.href && item.href.includes('~large.jpg'));
            const firstJpgItem = items.find(item => item.href && item.href.toLowerCase().endsWith('.jpg'));

            finalImageUrl = originalImageUrlItem?.href || largeImageUrlItem?.href || firstJpgItem?.href;
        }

        if (!finalImageUrl) {
            throw new Error('Could not find a downloadable image URL');
        }

        console.log(`Image URL: ${finalImageUrl}`);

        // Download the image
        console.log(`Downloading image...`);
        const writer = require('fs').createWriteStream(tempImagePath);
        const downloadResponse = await axios({
            url: finalImageUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: REQUEST_TIMEOUT,
            maxContentLength: 1024 * 1024 * 1024 // 1GB max
        });

        downloadResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`✓ Download complete`);
                resolve();
            });
            writer.on('error', reject);
        });

        // Process with VIPS
        await fs.mkdir(imageFolderPath, { recursive: true });
        const vipsCommand = `vips dzsave "${tempImagePath}" "${path.join(imageFolderPath, 'tiles')}"`;
        console.log(`Processing with VIPS...`);

        const { stdout, stderr } = await execAsync(vipsCommand, { timeout: REQUEST_TIMEOUT });
        if (stderr) {
            console.log(`VIPS stderr: ${stderr}`);
        }
        console.log(`✓ VIPS processing complete`);

        // Update databases
        console.log(`Updating databases...`);
        const imagesDb = await readJsonFile(imagesDbPath, []);
        const annotationsDb = await readJsonFile(annotationsDbPath, {});

        if (!imagesDb.find(img => img.id === imageId)) {
            imagesDb.push({
                id: imageId,
                name: sanitizeFilename(title),
                path: relativeDziPath,
                source: 'nasa',
                nasa_id: nasa_id,
                created: new Date().toISOString()
            });

            if (!annotationsDb[imageId]) {
                annotationsDb[imageId] = [];
            }

            await writeJsonFile(imagesDbPath, imagesDb);
            await writeJsonFile(annotationsDbPath, annotationsDb);
        }

        console.log(`✓ Databases updated`);
        console.log(`=== Processing Complete ===\n`);

        res.status(201).json({ id: imageId, path: relativeDziPath });

    } catch (error) {
        console.error('Error during NASA image processing:', error.message);

        // Cleanup on error
        await Promise.allSettled([
            cleanupTempFile(tempImagePath),
            fs.rm(imageFolderPath, { recursive: true, force: true })
        ]);

        res.status(500).send(`Failed to process NASA image: ${error.message}`);
    } finally {
        await cleanupTempFile(tempImagePath);
    }
});

// Process image from direct URL
app.post('/api/process-url', async (req, res) => {
    const { imageUrl } = req.body;

    console.log(`\n=== URL Processing Request ===`);
    console.log(`URL: ${imageUrl}`);

    // Validate URL
    if (!imageUrl || typeof imageUrl !== 'string') {
        return res.status(400).send('Image URL is required');
    }

    if (imageUrl.length > MAX_URL_LENGTH) {
        return res.status(400).send('URL is too long');
    }

    if (!isValidUrl(imageUrl)) {
        return res.status(400).send('Invalid URL format');
    }

    let imageId, title, tempImagePath, imageFolderPath, relativeDziPath;

    try {
        imageId = crypto.createHash('md5').update(imageUrl).digest('hex');
        const urlObj = new URL(imageUrl);
        title = sanitizeFilename(path.basename(urlObj.pathname) || 'image');
        
        imageFolderPath = path.join(gigaImagesPath, imageId);
        const dziPath = path.join(imageFolderPath, 'tiles.dzi');
        relativeDziPath = `gigaimages/${imageId}/tiles.dzi`;
        tempImagePath = path.join(dataPath, `${imageId}_temp${path.extname(title) || '.tmp'}`);

        // Check if already processed
        try {
            await fs.access(dziPath);
            console.log(`✓ Image already processed, serving from cache`);
            return res.json({ id: imageId, path: relativeDziPath });
        } catch (e) {
            console.log(`Processing new image from URL...`);
        }

        // Download the image
        console.log(`Downloading image...`);
        const writer = require('fs').createWriteStream(tempImagePath);
        const downloadResponse = await axios({
            url: imageUrl,
            method: 'GET',
            responseType: 'stream',
            timeout: REQUEST_TIMEOUT,
            maxContentLength: 1024 * 1024 * 1024, // 1GB max
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ImageViewer/1.0)'
            }
        });

        // Check content type
        const contentType = downloadResponse.headers['content-type'];
        if (contentType && !contentType.startsWith('image/')) {
            throw new Error(`URL does not point to an image (Content-Type: ${contentType})`);
        }

        downloadResponse.data.pipe(writer);

        await new Promise((resolve, reject) => {
            writer.on('finish', () => {
                console.log(`✓ Download complete`);
                resolve();
            });
            writer.on('error', reject);
            downloadResponse.data.on('error', reject);
        });

        // Verify file was downloaded
        const stats = await fs.stat(tempImagePath);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }
        console.log(`Downloaded ${Math.round(stats.size / 1024 / 1024)}MB`);

        // Process with VIPS
        await fs.mkdir(imageFolderPath, { recursive: true });
        const vipsCommand = `vips dzsave "${tempImagePath}" "${path.join(imageFolderPath, 'tiles')}"`;
        console.log(`Processing with VIPS...`);

        const { stdout, stderr } = await execAsync(vipsCommand, { timeout: REQUEST_TIMEOUT });
        if (stderr) {
            console.log(`VIPS stderr: ${stderr}`);
        }
        console.log(`✓ VIPS processing complete`);

        // Update databases
        console.log(`Updating databases...`);
        const imagesDb = await readJsonFile(imagesDbPath, []);
        const annotationsDb = await readJsonFile(annotationsDbPath, {});

        if (!imagesDb.find(img => img.id === imageId)) {
            imagesDb.push({
                id: imageId,
                name: title,
                path: relativeDziPath,
                source: 'url',
                sourceUrl: imageUrl,
                created: new Date().toISOString()
            });

            if (!annotationsDb[imageId]) {
                annotationsDb[imageId] = [];
            }

            await writeJsonFile(imagesDbPath, imagesDb);
            await writeJsonFile(annotationsDbPath, annotationsDb);
        }

        console.log(`✓ Databases updated`);
        console.log(`=== Processing Complete ===\n`);

        res.status(201).json({ id: imageId, path: relativeDziPath });

    } catch (error) {
        console.error('Error during URL processing:', error.message);

        // Cleanup on error
        if (tempImagePath) {
            await cleanupTempFile(tempImagePath);
        }
        if (imageFolderPath) {
            await fs.rm(imageFolderPath, { recursive: true, force: true }).catch(() => {});
        }

        // Provide more specific error messages
        let errorMessage = 'Failed to process image from URL';
        if (error.code === 'ENOTFOUND') {
            errorMessage = 'Could not reach the URL. Please check the address.';
        } else if (error.code === 'ETIMEDOUT') {
            errorMessage = 'Request timed out. The server may be slow or unreachable.';
        } else if (error.message.includes('VIPS')) {
            errorMessage = 'Failed to process image. The file may be corrupted or in an unsupported format.';
        } else if (error.message) {
            errorMessage += `: ${error.message}`;
        }

        res.status(500).send(errorMessage);
    } finally {
        if (tempImagePath) {
            await cleanupTempFile(tempImagePath);
        }
    }
});

// Search NASA API
app.get('/api/nasa/search', async (req, res) => {
    const query = req.query.q;

    if (!query || typeof query !== 'string') {
        return res.status(400).send('Search query is required');
    }

    if (query.length < 2) {
        return res.status(400).send('Search query must be at least 2 characters');
    }

    if (query.length > 200) {
        return res.status(400).send('Search query is too long');
    }

    console.log(`NASA search query: "${query}"`);

    try {
        const nasaApiUrl = 'https://images-api.nasa.gov/search';
        const response = await axios.get(nasaApiUrl, {
            params: {
                q: query,
                media_type: 'image'
            },
            timeout: 10000
        });

        if (!response.data || !response.data.collection || !response.data.collection.items) {
            return res.json([]);
        }

        const results = response.data.collection.items
            .map(item => {
                if (!item.data || !item.data[0]) return null;
                return {
                    nasa_id: item.data[0].nasa_id,
                    title: item.data[0].title || 'Untitled',
                    thumbnail: item.links && item.links[0] ? item.links[0].href : null,
                    description: item.data[0].description || ''
                };
            })
            .filter(item => item && item.nasa_id && item.thumbnail)
            .slice(0, 50);

        console.log(`Found ${results.length} results`);
        res.json(results);

    } catch (error) {
        console.error('NASA API search error:', error.message);
        if (error.response) {
            res.status(error.response.status).send('NASA API error');
        } else {
            res.status(500).send('Failed to search NASA images');
        }
    }
});

// Get annotations for an image
app.get('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;

    if (!imageId || imageId.length > 100) {
        return res.status(400).send('Invalid image ID');
    }

    console.log(`Fetching annotations for image: ${imageId}`);

    try {
        const allAnnotations = await readJsonFile(annotationsDbPath, {});
        const imageAnnotations = allAnnotations[imageId] || [];
        res.json(imageAnnotations);
    } catch (error) {
        console.error('Error reading annotations:', error);
        res.status(500).send('Failed to read annotations');
    }
});

// Save annotation for an image
app.post('/api/images/:id/annotations', async (req, res) => {
    const imageId = req.params.id;
    const annotation = req.body;

    if (!imageId || imageId.length > 100) {
        return res.status(400).send('Invalid image ID');
    }

    // Validate annotation
    if (!annotation || typeof annotation !== 'object') {
        return res.status(400).send('Invalid annotation data');
    }

    if (!annotation.id || !annotation.text || !annotation.point) {
        return res.status(400).send('Annotation missing required fields');
    }

    if (typeof annotation.text !== 'string' || annotation.text.length > MAX_ANNOTATION_LENGTH) {
        return res.status(400).send('Invalid annotation text');
    }

    if (typeof annotation.point.x !== 'number' || typeof annotation.point.y !== 'number') {
        return res.status(400).send('Invalid annotation coordinates');
    }

    console.log(`Saving annotation for image: ${imageId}`);

    try {
        const allAnnotations = await readJsonFile(annotationsDbPath, {});

        if (!allAnnotations[imageId]) {
            allAnnotations[imageId] = [];
        }

        allAnnotations[imageId].push(annotation);
        await writeJsonFile(annotationsDbPath, allAnnotations);

        console.log(`✓ Annotation saved`);
        res.status(201).json(annotation);

    } catch (error) {
        console.error('Error saving annotation:', error);
        res.status(500).send('Failed to save annotation');
    }
});

// Delete an image
app.delete('/api/images/:id', async (req, res) => {
    const { id } = req.params;

    if (!id || id.length > 100) {
        return res.status(400).send('Invalid image ID');
    }

    console.log(`\n=== Delete Image Request ===`);
    console.log(`Image ID: ${id}`);

    const imageFolderPath = path.join(gigaImagesPath, id);

    try {
        // Read databases
        const imagesDb = await readJsonFile(imagesDbPath, []);
        const annotationsDb = await readJsonFile(annotationsDbPath, {});

        // Remove from databases
        const imageIndex = imagesDb.findIndex(img => img.id === id);
        if (imageIndex === -1) {
            console.log(`Image ${id} not found in database`);
        } else {
            imagesDb.splice(imageIndex, 1);
            console.log(`✓ Removed from images.json`);
        }

        if (annotationsDb[id]) {
            delete annotationsDb[id];
            console.log(`✓ Removed from annotations.json`);
        }

        // Write updated databases
        await writeJsonFile(imagesDbPath, imagesDb);
        await writeJsonFile(annotationsDbPath, annotationsDb);
        console.log(`✓ Databases updated`);

        // Delete image folder
        try {
            await fs.rm(imageFolderPath, { recursive: true, force: true });
            console.log(`✓ Image folder deleted`);
        } catch (fsError) {
            console.warn(`Could not delete folder ${imageFolderPath}:`, fsError.message);
        }

        console.log(`=== Deletion Complete ===\n`);
        res.status(200).json({ message: `Image ${id} deleted successfully` });

    } catch (error) {
        console.error(`Error deleting image ${id}:`, error);
        res.status(500).send(`Failed to delete image: ${error.message}`);
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    try {
        const vipsInstalled = await checkVipsInstalled();
        res.json({
            status: 'ok',
            vipsInstalled,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).send('Not found');
});

// Start the server
app.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`Server running at http://localhost:${PORT}`);
    console.log(`========================================\n`);
});