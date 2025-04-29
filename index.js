/**
 * Multi-Account File Manager
 * Node.js version for Render hosting
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const crypto = require('crypto');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Configure middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 1000 * 1024 * 1024 } // 100MB limit
});

// Create temp directory for file uploads if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Parse bucket configuration from environment variable
let bucketConfig;
try {
  bucketConfig = JSON.parse(process.env.BUCKET_CONFIG);
} catch (error) {
  console.error('Error parsing bucket config:', error);
  bucketConfig = {};
}

// Cache for B2 auth tokens
const authTokenCache = new Map();
// Cache for file listings
const fileListCache = new Map();
const FILE_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper function to get B2 authorization
async function getAuthToken(account) {
  // Check if we have a cached token
  if (authTokenCache.has(account)) {
    return authTokenCache.get(account);
  }
  
  let keyId, applicationKey;
  
  if (account === 'account1') {
    keyId = process.env.ACCOUNT1_KEY_ID;
    applicationKey = process.env.ACCOUNT1_APPLICATION_KEY;
  } else if (account === 'account2') {
    keyId = process.env.ACCOUNT2_KEY_ID;
    applicationKey = process.env.ACCOUNT2_APPLICATION_KEY;
  } else {
    throw new Error('Invalid account');
  }
  
  // Authorize with B2
  const authResponse = await fetch('https://api.backblazeb2.com/b2api/v2/b2_authorize_account', {
    headers: {
      'Authorization': 'Basic ' + Buffer.from(keyId + ':' + applicationKey).toString('base64')
    }
  });
  
  if (!authResponse.ok) {
    throw new Error('Failed to authenticate with B2');
  }
  
  const authData = await authResponse.json();
  
  // Cache the auth data
  authTokenCache.set(account, authData);
  
  return authData;
}

// Helper function to list files in a bucket
async function listFiles(account) {
  // Check cache first
  const cacheKey = `files_${account}`;
  if (fileListCache.has(cacheKey)) {
    const { timestamp, files } = fileListCache.get(cacheKey);
    if (Date.now() - timestamp < FILE_CACHE_TTL) {
      return files;
    }
  }

  try {
    const authData = await getAuthToken(account);
    
    const response = await fetch(`${authData.apiUrl}/b2api/v2/b2_list_file_names`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketConfig[account].bucketId,
        prefix: 'files/',
        maxFileCount: 1000
      })
    });
    
    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.status}`);
    }
    
    const result = await response.json();
    const files = result.files.map(file => {
      // Extract the filename without the 'files/' prefix
      const filename = file.fileName.replace('files/', '');
      // Parse the original title from the filename (remove timestamp)
      const parts = filename.split('_');
      const timestamp = parts.pop().split('.')[0];
      const title = parts.join('_').replace(/_/g, ' ');
      
      return {
        fileName: filename,
        fullFileName: file.fileName,
        fileId: file.fileId,
        size: file.size,
        uploadTimestamp: file.uploadTimestamp,
        contentType: file.contentType,
        title: title,
        url: `/files/${account}/${filename}`,
        account: account
      };
    });
    
    // Sort by upload timestamp, newest first
    files.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
    
    // Cache the result
    fileListCache.set(cacheKey, {
      timestamp: Date.now(),
      files: files
    });
    
    return files;
  } catch (error) {
    console.error('Error listing files:', error);
    return [];
  }
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Home page
app.get('/', async (req, res) => {
  try {
    const accountList = Object.keys(bucketConfig);
    
    // Get files from all accounts and combine them
    let allFiles = [];
    for (const account of accountList) {
      try {
        const files = await listFiles(account);
        allFiles = allFiles.concat(files);
      } catch (error) {
        console.error(`Error listing files for ${account}:`, error);
      }
    }
    
    // Sort all files by upload timestamp, newest first
    allFiles.sort((a, b) => b.uploadTimestamp - a.uploadTimestamp);
    
    // Generate the HTML
    const html = generateHTML(accountList, allFiles);
    
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (error) {
    console.error('Error handling home request:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Handle file uploads
app.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { account, title } = req.body;
    const file = req.file;
    
    // Validate inputs
    if (!account || !title || !file) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if the account exists in our configuration
    if (!bucketConfig[account]) {
      return res.status(400).json({ error: 'Invalid account selected' });
    }
    
    // Generate a safe filename (sanitize the title)
    const safeTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const timestamp = Date.now();
    const filename = `${safeTitle}_${timestamp}`;
    const extension = file.originalname.split('.').pop();
    const fullFilename = `${filename}.${extension}`;
    const b2FileName = `files/${fullFilename}`;
    
    // Get file data as Buffer
    const fileData = file.buffer;
    
    // Get auth token for the selected account
    const authData = await getAuthToken(account);
    
    // Get upload URL
    const uploadUrlResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_upload_url`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketConfig[account].bucketId
      })
    });
    
    if (!uploadUrlResponse.ok) {
      throw new Error('Failed to get upload URL from B2');
    }
    
    const uploadUrlData = await uploadUrlResponse.json();
    
    // Calculate SHA1 hash of the file
    const sha1 = crypto.createHash('sha1').update(fileData).digest('hex');
    
    // Upload file to B2
    const uploadResponse = await fetch(uploadUrlData.uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': uploadUrlData.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(b2FileName),
        'Content-Type': file.mimetype || 'application/octet-stream',
        'X-Bz-Content-Sha1': sha1,
        'X-Bz-Info-Author': 'file-manager-node'
      },
      body: fileData
    });
    
    if (!uploadResponse.ok) {
      throw new Error('Failed to upload file to B2');
    }
    
    const uploadResult = await uploadResponse.json();
    
    // Clear the file list cache for this account
    fileListCache.delete(`files_${account}`);
    
    // Generate a URL for the uploaded file
    const fileUrl = `/files/${account}/${fullFilename}`;
    
    // Return success response with the URL
    return res.json({
      success: true,
      url: fileUrl,
      title: title,
      filename: fullFilename,
      b2FileId: uploadResult.fileId
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Handle file deletion
app.post('/delete-file', async (req, res) => {
  try {
    const { account, fileId, fileName } = req.body;
    
    // Validate inputs
    if (!account || !fileId || !fileName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if the account exists in our configuration
    if (!bucketConfig[account]) {
      return res.status(400).json({ error: 'Invalid account selected' });
    }
    
    // Get auth token for the selected account
    const authData = await getAuthToken(account);
    
    // Delete file from B2
    const deleteResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_delete_file_version`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fileId: fileId,
        fileName: fileName
      })
    });
    
    if (!deleteResponse.ok) {
      throw new Error('Failed to delete file from B2');
    }
    
    // Clear the file list cache for this account
    fileListCache.delete(`files_${account}`);
    
    // Return success response
    return res.json({
      success: true,
      message: 'File deleted successfully'
    });
    
  } catch (error) {
    console.error('Delete error:', error);
    return res.status(500).json({ error: error.message });
  }
});

// Handle file serving
app.get('/files/:account/:filename', async (req, res) => {
  try {
    // Parse the URL to get account and filename
    const account = req.params.account;
    const filename = req.params.filename;
    
    // Check if the account exists
    if (!bucketConfig[account]) {
      return res.status(400).send('Invalid account');
    }
    
    // Get auth token for the account
    const authData = await getAuthToken(account);
    
    // Get download authorization
    const downloadAuthResponse = await fetch(`${authData.apiUrl}/b2api/v2/b2_get_download_authorization`, {
      method: 'POST',
      headers: {
        'Authorization': authData.authorizationToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        bucketId: bucketConfig[account].bucketId,
        fileNamePrefix: `files/${filename}`,
        validDurationInSeconds: 86400 // 24 hours
      })
    });
    
    if (!downloadAuthResponse.ok) {
      throw new Error('Failed to get download authorization');
    }
    
    const downloadAuthData = await downloadAuthResponse.json();
    
    // Create a direct download URL with the authorization token
    const directDownloadUrl = `${authData.downloadUrl}/file/${bucketConfig[account].bucketName}/files/${filename}?Authorization=${downloadAuthData.authorizationToken}`;
    
    // Redirect to the direct download URL
    return res.redirect(directDownloadUrl);
    
  } catch (error) {
    console.error('File serving error:', error);
    return res.status(500).send(`Error serving file: ${error.message}`);
  }
});

// Generate HTML for the home page
function generateHTML(accountList, allFiles) {
  // This function is the same as in your original code
  // I'm assuming you want to keep it as is, so I'm not including the full HTML here
  // You can copy it from your original code
  return `<!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>File Manager</title>
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
      <style>
          :root {
              --bg-color: #0f0f0f;
              --card-bg: #1a1a1a;
              --sidebar-bg: #141414;
              --text-color: #f5f5f5;
              --accent-color: #7c4dff;
              --accent-hover: #9e7bff;
              --error-color: #ff5252;
              --success-color: #4caf50;
              --border-color: #2c2c2c;
              --secondary-text: #aaaaaa;
              --hover-bg: #252525;
          }
          
          * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
          }
          
          body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              background-color: var(--bg-color);
              color: var(--text-color);
              line-height: 1.6;
              overflow-x: hidden;
          }
          
          .app-container {
              display: flex;
              min-height: 100vh;
          }
          
          /* Sidebar Styles */
          .sidebar {
              width: 280px;
              background-color: var(--sidebar-bg);
              padding: 20px 0;
              box-shadow: 2px 0 5px rgba(0, 0, 0, 0.2);
              z-index: 10;
              transition: transform 0.3s ease;
          }
          
          .sidebar-header {
              padding: 0 20px 20px;
              border-bottom: 1px solid var(--border-color);
              margin-bottom: 20px;
          }
          
          .logo {
              font-size: 1.5rem;
              font-weight: bold;
              color: var(--accent-color);
              display: flex;
              align-items: center;
              gap: 10px;
          }
          
          .nav-menu {
              list-style: none;
          }
          
          .nav-item {
              margin-bottom: 5px;
          }
          
          .nav-link {
              display: flex;
              align-items: center;
              padding: 12px 20px;
              color: var(--text-color);
              text-decoration: none;
              transition: background-color 0.2s;
              border-left: 3px solid transparent;
          }
          
          .nav-link:hover, .nav-link.active {
              background-color: var(--hover-bg);
              border-left-color: var(--accent-color);
          }
          
          .nav-link i {
              margin-right: 10px;
              width: 20px;
              text-align: center;
          }
          
          .upload-btn {
              margin: 20px;
              padding: 12px;
              background-color: var(--accent-color);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: 500;
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 8px;
              transition: background-color 0.2s;
          }
          
          .upload-btn:hover {
              background-color: var(--accent-hover);
          }
          
          /* Main Content Styles */
          .main-content {
              flex: 1;
              padding: 30px;
              overflow-y: auto;
          }
          
          .page-header {
              margin-bottom: 30px;
              display: flex;
              justify-content: space-between;
              align-items: center;
              flex-wrap: wrap;
              gap: 15px;
          }
          
          .page-title {
              font-size: 1.8rem;
              font-weight: 600;
          }
          
          .search-container {
              position: relative;
              width: 300px;
          }
          
          .search-input {
              width: 100%;
              padding: 10px 15px 10px 40px;
              border-radius: 6px;
              border: 1px solid var(--border-color);
              background-color: var(--card-bg);
              color: var(--text-color);
              font-size: 0.9rem;
          }
          
          .search-icon {
              position: absolute;
              left: 15px;
              top: 50%;
              transform: translateY(-50%);
              color: var(--secondary-text);
          }
          
          .filter-container {
              display: flex;
              gap: 10px;
          }
          
          .filter-select {
              padding: 10px 15px;
              border-radius: 6px;
              border: 1px solid var(--border-color);
              background-color: var(--card-bg);
              color: var(--text-color);
              font-size: 0.9rem;
              cursor: pointer;
          }
          
          /* File Grid Styles */
          .file-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
              gap: 20px;
              margin-bottom: 40px;
          }
          
          .file-card {
              background-color: var(--card-bg);
              border-radius: 8px;
              overflow: hidden;
              transition: transform 0.2s, box-shadow 0.2s;
              box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
              cursor: pointer;
              position: relative;
          }
          
          .file-card:hover {
              transform: translateY(-5px);
              box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
          }
          
          .file-thumbnail {
              height: 120px;
              background-color: #2a2a2a;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              position: relative;
          }
          
          .file-thumbnail.video {
              background-color: #2d1d4d;
          }
          
          .file-thumbnail.image {
              background-color: #1d3d4d;
          }
          
          .file-thumbnail.document {
              background-color: #3d1d1d;
          }
          
          .file-thumbnail.audio {
              background-color: #1d3d2d;
          }
          
          .file-thumbnail i {
              font-size: 2.5rem;
              color: var(--accent-color);
          }
          
          .file-thumbnail img, .file-thumbnail video {
              width: 100%;
              height: 100%;
              object-fit: cover;
          }
          
          .file-account-badge {
              position: absolute;
              top: 10px;
              right: 10px;
              background-color: rgba(0, 0, 0, 0.6);
              color: white;
              font-size: 0.7rem;
              padding: 3px 8px;
              border-radius: 10px;
          }
          
          .file-info {
              padding: 15px;
          }
          
          .file-name {
              font-weight: 500;
              margin-bottom: 5px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
          }
          
          .file-meta {
              font-size: 0.8rem;
              color: var(--secondary-text);
              display: flex;
              justify-content: space-between;
          }
          
          .file-actions {
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background-color: rgba(0, 0, 0, 0.7);
              display: flex;
              align-items: center;
              justify-content: center;
              gap: 15px;
              opacity: 0;
              transition: opacity 0.2s;
          }
          
          .file-card:hover .file-actions {
              opacity: 1;
          }
          
          .file-action-btn {
              width: 40px;
              height: 40px;
              border-radius: 50%;
              background-color: var(--accent-color);
              color: white;
              border: none;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: transform 0.2s, background-color 0.2s;
          }
          
          .file-action-btn:hover {
              transform: scale(1.1);
              background-color: var(--accent-hover);
          }
          
          .file-action-btn.delete {
              background-color: var(--error-color);
          }
          
          .file-action-btn.delete:hover {
              background-color: #ff7070;
          }
          
          .empty-message {
              text-align: center;
              padding: 40px;
              color: var(--secondary-text);
              font-size: 1.1rem;
          }
          
          /* Upload Modal Styles */
          .modal {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.7);
              z-index: 100;
              overflow: auto;
              animation: fadeIn 0.3s;
          }
          
          .modal-content {
              background-color: var(--card-bg);
              margin: 50px auto;
              width: 90%;
              max-width: 600px;
              border-radius: 8px;
              box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
              animation: slideIn 0.3s;
          }
          
          .modal-header {
              padding: 20px;
              border-bottom: 1px solid var(--border-color);
              display: flex;
              justify-content: space-between;
              align-items: center;
          }
          
          .modal-title {
              font-size: 1.2rem;
              font-weight: 600;
          }
          
          .close-btn {
              background: none;
              border: none;
              color: var(--secondary-text);
              font-size: 1.5rem;
              cursor: pointer;
              transition: color 0.2s;
          }
          
          .close-btn:hover {
              color: var(--text-color);
          }
          
          .modal-body {
              padding: 20px;
          }
          
          .form-group {
              margin-bottom: 20px;
          }
          
          .form-label {
              display: block;
              margin-bottom: 8px;
              font-weight: 500;
          }
          
          .form-control {
              width: 100%;
              padding: 12px;
              border-radius: 6px;
              border: 1px solid var(--border-color);
              background-color: var(--bg-color);
              color: var(--text-color);
              font-size: 1rem;
          }
          
          .form-select {
              width: 100%;
              padding: 12px;
              border-radius: 6px;
              border: 1px solid var(--border-color);
              background-color: var(--bg-color);
              color: var(--text-color);
              font-size: 1rem;
              appearance: none;
              background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='%23aaa' viewBox='0 0 16 16'%3E%3Cpath d='M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z'/%3E%3C/svg%3E");
              background-repeat: no-repeat;
              background-position: right 12px center;
              background-size: 16px;
          }
          
          .file-input-container {
              position: relative;
              margin-bottom: 20px;
          }
          
          .file-input-label {
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 30px 20px;
              border: 2px dashed var(--border-color);
              border-radius: 6px;
              cursor: pointer;
              text-align: center;
              transition: all 0.2s;
          }
          
          .file-input-label:hover, .file-input-label.dragover {
              border-color: var(--accent-color);
              background-color: rgba(124, 77, 255, 0.05);
          }
          
          .file-input-label i {
              font-size: 2rem;
              margin-bottom: 10px;
              color: var(--accent-color);
          }
          
          .file-input {
              position: absolute;
              width: 0.1px;
              height: 0.1px;
              opacity: 0;
              overflow: hidden;
              z-index: -1;
          }
          
          .file-input-text {
              display: flex;
              flex-direction: column;
              align-items: center;
          }
          
          .file-name-display {
              margin-top: 10px;
              font-size: 0.9rem;
              color: var(--accent-color);
              word-break: break-all;
              display: none;
          }
          
          .submit-btn {
              width: 100%;
              padding: 12px;
              background-color: var(--accent-color);
              color: white;
              border: none;
              border-radius: 6px;
              cursor: pointer;
              font-weight: 500;
              transition: background-color 0.2s;
          }
          
          .submit-btn:hover {
              background-color: var(--accent-hover);
          }
          
          .progress-container {
              margin-top: 20px;
              display: none;
          }
          
          .progress-bar-container {
              height: 6px;
              background-color: var(--border-color);
              border-radius: 3px;
              overflow: hidden;
              margin-bottom: 8px;
          }
          
          .progress-bar {
              height: 100%;
              background-color: var(--accent-color);
              width: 0%;
              transition: width 0.3s;
          }
          
          .progress-text {
              text-align: center;
              font-size: 0.9rem;
              color: var(--secondary-text);
          }
          
          /* Alert Styles */
          .alert {
              padding: 15px;
              border-radius: 6px;
              margin-bottom: 20px;
              display: none;
          }
          
          .alert-success {
              background-color: rgba(76, 175, 80, 0.1);
              border: 1px solid var(--success-color);
              color: var(--success-color);
          }
          
          .alert-error {
              background-color: rgba(255, 82, 82, 0.1);
              border: 1px solid var(--error-color);
              color: var(--error-color);
          }
          
          /* File Viewer Modal */
          .file-viewer-modal {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.9);
              z-index: 200;
              overflow: auto;
              animation: fadeIn 0.3s;
          }
          
          .file-viewer-content {
              margin: 30px auto;
              width: 90%;
              max-width: 1200px;
              animation: zoomIn 0.3s;
          }
          
          .file-viewer-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              padding: 15px;
              background-color: rgba(26, 26, 26, 0.8);
              border-radius: 8px 8px 0 0;
              backdrop-filter: blur(10px);
          }
          
          .file-viewer-title {
              font-size: 1.2rem;
              font-weight: 500;
              color: white;
          }
          
          .file-viewer-close {
              background: none;
              border: none;
              color: white;
              font-size: 1.5rem;
              cursor: pointer;
              opacity: 0.8;
              transition: opacity 0.2s;
          }
          
          .file-viewer-close:hover {
              opacity: 1;
          }
          
          .file-viewer-body {
              background-color: var(--card-bg);
              border-radius: 0 0 8px 8px;
              overflow: hidden;
              padding: 20px;
              text-align: center;
          }
          
          .file-viewer-body img {
              max-width: 100%;
              max-height: 80vh;
              border-radius: 4px;
          }
          
          .file-viewer-controls {
              display: flex;
              justify-content: center;
              margin-top: 20px;
              gap: 15px;
              flex-wrap: wrap;
          }
          
          .file-viewer-btn {
              padding: 8px 15px;
              background-color: rgba(124, 77, 255, 0.2);
              color: var(--accent-color);
              border: 1px solid var(--accent-color);
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.9rem;
              transition: all 0.2s;
              display: flex;
              align-items: center;
              gap: 8px;
          }
          
          .file-viewer-btn:hover {
              background-color: var(--accent-color);
              color: white;
          }
          
          .file-viewer-btn.delete {
              background-color: rgba(255, 82, 82, 0.2);
              color: var(--error-color);
              border-color: var(--error-color);
          }
          
          .file-viewer-btn.delete:hover {
              background-color: var(--error-color);
              color: white;
          }
          
          /* Confirm Delete Modal */
          .confirm-modal {
              display: none;
              position: fixed;
              top: 0;
              left: 0;
              width: 100%;
              height: 100%;
              background-color: rgba(0, 0, 0, 0.7);
              z-index: 300;
              overflow: auto;
              animation: fadeIn 0.3s;
          }
          
          .confirm-content {
              background-color: var(--card-bg);
              margin: 100px auto;
              width: 90%;
              max-width: 400px;
              border-radius: 8px;
              box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
              animation: slideIn 0.3s;
              padding: 20px;
          }
          
          .confirm-title {
              font-size: 1.2rem;
              font-weight: 600;
              margin-bottom: 15px;
              color: var(--error-color);
          }
          
          .confirm-message {
              margin-bottom: 20px;
              color: var(--text-color);
          }
          
          .confirm-buttons {
              display: flex;
              justify-content: flex-end;
              gap: 10px;
          }
          
          .confirm-btn {
              padding: 8px 15px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 0.9rem;
              transition: all 0.2s;
          }
          
          .confirm-btn.cancel {
              background-color: var(--card-bg);
              color: var(--text-color);
              border: 1px solid var(--border-color);
          }
          
          .confirm-btn.cancel:hover {
              background-color: var(--hover-bg);
          }
          
          .confirm-btn.delete {
              background-color: var(--error-color);
              color: white;
              border: none;
          }
          
          .confirm-btn.delete:hover {
              background-color: #ff7070;
          }
          
          /* Custom Video Player Styles */
          .custom-video-player {
              position: relative;
              width: 100%;
              max-height: 80vh;
              background-color: #000;
              border-radius: 8px;
              overflow: hidden;
          }
          
          .video-element {
              width: 100%;
              height: 100%;
              display: block;
          }
          
          .video-controls {
              position: absolute;
              bottom: 0;
              left: 0;
              right: 0;
              background: linear-gradient(to top, rgba(0, 0, 0, 0.8), transparent);
              padding: 20px 15px 10px;
              transition: opacity 0.3s ease;
              opacity: 0;
          }
          
          .custom-video-player:hover .video-controls {
              opacity: 1;
          }
          
          .progress-container {
              height: 5px;
              background-color: rgba(255, 255, 255, 0.2);
              border-radius: 2.5px;
              cursor: pointer;
              position: relative;
              margin-bottom: 10px;
              overflow: hidden;
          }
          
          .buffered-progress {
              position: absolute;
              top: 0;
              left: 0;
              height: 100%;
              background-color: rgba(255, 255, 255, 0.4);
              width: 0%;
              border-radius: 2.5px;
          }
          
          .progress-bar {
              position: absolute;
              top: 0;
              left: 0;
              height: 100%;
              background-color: var(--accent-color);
              width: 0%;
              border-radius: 2.5px;
              transition: width 0.1s linear;
          }
          
          .progress-thumb {
              position: absolute;
              right: -6px;
              top: 50%;
              transform: translateY(-50%);
              width: 12px;
              height: 12px;
              background-color: var(--accent-color);
              border-radius: 50%;
              box-shadow: 0 0 5px rgba(0, 0, 0, 0.5);
              opacity: 0;
              transition: opacity 0.2s;
          }
          
          .progress-container:hover .progress-thumb {
              opacity: 1;
          }
          
          .control-buttons {
              display: flex;
              align-items: center;
              justify-content: space-between;
          }
          
          .control-btn {
              background: none;
              border: none;
              color: white;
              font-size: 16px;
              cursor: pointer;
              padding: 5px;
              margin: 0 5px;
              opacity: 0.85;
              transition: opacity 0.2s;
          }
          
          .control-btn:hover {
              opacity: 1;
          }
          
          .timestamp {
              color: white;
              font-size: 14px;
              margin: 0 10px;
              flex-grow: 1;
              text-align: center;
          }
          
          .volume-container {
              position: relative;
              display: flex;
              align-items: center;
          }
          
          .volume-slider {
              width: 0;
              height: 4px;
              background-color: rgba(255, 255, 255, 0.2);
              border-radius: 2px;
              cursor: pointer;
              overflow: hidden;
              transition: width 0.2s;
              margin-left: 5px;
          }
          
          .volume-container:hover .volume-slider {
              width: 60px;
          }
          
          .volume-progress {
              height: 100%;
              background-color: white;
              width: 75%;
          }
          
          .big-play-button {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              width: 80px;
              height: 80px;
              background-color: rgba(0, 0, 0, 0.6);
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              cursor: pointer;
              transition: all 0.2s;
          }
          
          .big-play-button i {
              color: white;
              font-size: 30px;
              margin-left: 5px; /* Offset for play icon */
          }
          
          .big-play-button:hover {
              background-color: var(--accent-color);
              transform: translate(-50%, -50%) scale(1.1);
          }
          
          .loading-spinner {
              position: absolute;
              top: 50%;
              left: 50%;
              transform: translate(-50%, -50%);
              display: flex;
              align-items: center;
              justify-content: center;
          }
          
          .spinner {
              width: 50px;
              height: 50px;
              border: 4px solid rgba(255, 255, 255, 0.3);
              border-radius: 50%;
              border-top-color: var(--accent-color);
              animation: spin 1s linear infinite;
          }
          
          @keyframes spin {
              to { transform: rotate(360deg); }
          }
          
          .speed-menu {
              position: absolute;
              bottom: 60px;
              right: 50px;
              background-color: rgba(28, 28, 28, 0.9);
              border-radius: 4px;
              padding: 5px 0;
              display: none;
              z-index: 10;
          }
          
          .speed-option {
              padding: 8px 15px;
              color: white;
              cursor: pointer;
              transition: background-color 0.2s;
          }
          
          .speed-option:hover {
              background-color: rgba(255, 255, 255, 0.1);
          }
          
          .speed-option[data-active="true"] {
              color: var(--accent-color);
          }
          
          /* Custom Audio Player Styles */
          .custom-audio-player {
              width: 100%;
              background-color: var(--card-bg);
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
          }
          
          .audio-visualization {
              display: flex;
              align-items: flex-end;
              justify-content: space-between;
              height: 100px;
              margin-bottom: 20px;
              padding: 0 10px;
          }
          
          .audio-bar {
              width: 8px;
              background: linear-gradient(to top, var(--accent-color), #9e7bff);
              border-radius: 4px;
              transition: height 0.2s ease;
          }
          
          .audio-controls {
              display: flex;
              align-items: center;
              gap: 15px;
          }
          
          .audio-control-btn {
              background: none;
              border: none;
              color: var(--text-color);
              font-size: 18px;
              cursor: pointer;
              padding: 5px;
          }
          
          .audio-progress-container {
              flex-grow: 1;
              height: 5px;
              background-color: rgba(255, 255, 255, 0.1);
              border-radius: 2.5px;
              cursor: pointer;
              position: relative;
              overflow: hidden;
          }
          
          .audio-progress {
              position: absolute;
              top: 0;
              left: 0;
              height: 100%;
              background-color: var(--accent-color);
              width: 0%;
              border-radius: 2.5px;
          }
          
          .audio-time {
              color: var(--text-color);
              font-size: 14px;
              min-width: 90px;
              text-align: center;
          }
          
          /* Toast Notification */
          .toast-container {
              position: fixed;
              bottom: 20px;
              right: 20px;
              z-index: 1000;
          }
          
          .toast {
              background-color: var(--card-bg);
              color: var(--text-color);
              padding: 15px 20px;
              border-radius: 6px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
              margin-top: 10px;
              display: flex;
              align-items: center;
              gap: 10px;
              animation: slideInRight 0.3s, fadeOut 0.3s 3s forwards;
              max-width: 300px;
          }
          
          .toast.success {
              border-left: 4px solid var(--success-color);
          }
          
          .toast.error {
              border-left: 4px solid var(--error-color);
          }
          
          .toast i {
              font-size: 1.2rem;
          }
          
          .toast.success i {
              color: var(--success-color);
          }
          
          .toast.error i {
              color: var(--error-color);
          }
          
          /* Mobile responsive adjustments */
          @media (max-width: 768px) {
              .app-container {
                  flex-direction: column;
              }
              
              .sidebar {
                  width: 100%;
                  position: fixed;
                  bottom: 0;
                  height: 60px;
                  padding: 0;
                  display: flex;
                  justify-content: space-around;
                  align-items: center;
              }
              
              .sidebar-header, .upload-btn {
                  display: none;
              }
              
              .nav-menu {
                  display: flex;
                  width: 100%;
                  justify-content: space-around;
              }
              
              .nav-item {
                  margin: 0;
                  flex: 1;
                  text-align: center;
              }
              
              .nav-link {
                  flex-direction: column;
                  padding: 8px 5px;
                  gap: 5px;
                  border-left: none;
                  border-top: 3px solid transparent;
                  font-size: 0.7rem;
              }
              
              .nav-link:hover, .nav-link.active {
                  border-left-color: transparent;
                  border-top-color: var(--accent-color);
              }
              
              .nav-link i {
                  margin-right: 0;
                  font-size: 1.2rem;
              }
              
              .main-content {
                  padding: 20px 15px 80px;
              }
              
              .page-header {
                  flex-direction: column;
                  align-items: flex-start;
                  gap: 15px;
              }
              
              .search-container {
                  width: 100%;
              }
              
              .filter-container {
                  width: 100%;
              }
              
              .filter-select {
                  flex: 1;
              }
              
              .file-grid {
                  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                  gap: 15px;
              }
              
              .modal-content, .file-viewer-content {
                  width: 95%;
                  margin: 20px auto;
              }
              
              .control-buttons {
                  flex-wrap: wrap;
              }
              
              .timestamp {
                  order: 1;
                  width: 100%;
                  margin: 10px 0 0;
              }
              
              .volume-container:hover .volume-slider {
                  width: 40px;
              }
              
              .big-play-button {
                  width: 60px;
                  height: 60px;
              }
              
              .big-play-button i {
                  font-size: 24px;
              }
              
              .audio-visualization {
                  height: 70px;
              }
              
              .audio-bar {
                  width: 6px;
              }
              
              .audio-time {
                  min-width: 80px;
                  font-size: 12px;
              }
              
              .file-viewer-controls {
                  justify-content: space-between;
              }
              
              .file-viewer-btn {
                  padding: 8px 10px;
                  font-size: 0.8rem;
              }
          }
          
          /* Animations */
          @keyframes fadeIn {
              from { opacity: 0; }
              to { opacity: 1; }
          }
          
          @keyframes fadeOut {
              from { opacity: 1; }
              to { opacity: 0; }
          }
          
          @keyframes slideIn {
              from { transform: translateY(-30px); opacity: 0; }
              to { transform: translateY(0); opacity: 1; }
          }
          
          @keyframes slideInRight {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
          }
          
          @keyframes zoomIn {
              from { transform: scale(0.9); opacity: 0; }
              to { transform: scale(1); opacity: 1; }
          }
          
          /* Utility Classes */
          .hidden {
              display: none;
          }
          
          .mobile-upload-btn {
              position: fixed;
              bottom: 80px;
              right: 20px;
              width: 60px;
              height: 60px;
              border-radius: 50%;
              background-color: var(--accent-color);
              color: white;
              display: none;
              align-items: center;
              justify-content: center;
              box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
              z-index: 50;
              cursor: pointer;
          }
          
          .mobile-upload-btn i {
              font-size: 1.5rem;
          }
          
          @media (max-width: 768px) {
              .mobile-upload-btn {
                  display: flex;
              }
          }
      </style>
  </head>
  <body>
      <div class="app-container">
          <!-- Sidebar -->
          <aside class="sidebar">
              <div class="sidebar-header">
                  <div class="logo">
                      <i class="fas fa-cloud"></i>
                      <span>File Manager</span>
                  </div>
              </div>
              
              <button class="upload-btn" id="openUploadBtn">
                  <i class="fas fa-upload"></i> Upload File
              </button>
              
              <ul class="nav-menu">
                  <li class="nav-item">
                      <a href="#" class="nav-link active">
                          <i class="fas fa-home"></i>
                          <span>Home</span>
                      </a>
                  </li>
                  <li class="nav-item">
                      <a href="#" class="nav-link">
                          <i class="fas fa-video"></i>
                          <span>Videos</span>
                      </a>
                  </li>
                  <li class="nav-item">
                      <a href="#" class="nav-link">
                          <i class="fas fa-image"></i>
                          <span>Images</span>
                      </a>
                  </li>
                  <li class="nav-item">
                      <a href="#" class="nav-link">
                          <i class="fas fa-file-alt"></i>
                          <span>Documents</span>
                      </a>
                  </li>
              </ul>
          </aside>
          
          <!-- Main Content -->
          <main class="main-content">
              <div class="page-header">
                  <h1 class="page-title">All Files</h1>
                  <div class="search-container">
                      <i class="fas fa-search search-icon"></i>
                      <input type="text" class="search-input" placeholder="Search files..." id="searchInput">
                  </div>
                  <div class="filter-container">
                      <select class="filter-select" id="typeFilter">
                          <option value="all">All Types</option>
                          <option value="video">Videos</option>
                          <option value="image">Images</option>
                          <option value="audio">Audio</option>
                          <option value="document">Documents</option>
                      </select>
                      <select class="filter-select" id="accountFilter">
                          <option value="all">All Accounts</option>
                          ${accountList.map(account => `<option value="${account}">${account}</option>`).join('')}
                      </select>
                      <select class="filter-select" id="sortFilter">
                          <option value="newest">Newest First</option>
                          <option value="oldest">Oldest First</option>
                          <option value="name">Name (A-Z)</option>
                          <option value="size">Size (Largest)</option>
                      </select>
                  </div>
              </div>
              
              <!-- File Grid -->
              <div class="file-grid" id="fileGrid">
                  ${allFiles.length > 0 ? allFiles.map(file => {
                      const isVideo = file.contentType.startsWith('video/');
                      const isImage = file.contentType.startsWith('image/');
                      const isAudio = file.contentType.startsWith('audio/');
                      const fileIcon = isVideo ? 'video' : (isImage ? 'image' : (isAudio ? 'music' : 'file-alt'));
                      const fileClass = isVideo ? 'video' : (isImage ? 'image' : (isAudio ? 'audio' : 'document'));
                      const fileType = isVideo ? 'video' : (isImage ? 'image' : (isAudio ? 'audio' : 'document'));
                      
                      return `
                          <div class="file-card" data-file='${JSON.stringify(file)}' data-type="${fileType}" data-account="${file.account}">
                              <div class="file-thumbnail ${fileClass}">
                                  ${isVideo ? `<i class="fas fa-play-circle"></i>` : 
                                    (isImage ? `<i class="fas fa-image"></i>` : 
                                    (isAudio ? `<i class="fas fa-music"></i>` : 
                                    `<i class="fas fa-${fileIcon}"></i>`))}
                                  <div class="file-account-badge">${file.account}</div>
                              </div>
                              <div class="file-info">
                                  <div class="file-name">${file.title}</div>
                                  <div class="file-meta">
                                      <span>${(file.size / 1024 / 1024).toFixed(2)} MB</span>
                                      <span>${new Date(file.uploadTimestamp).toLocaleDateString()}</span>
                                  </div>
                              </div>
                              <div class="file-actions">
                                  <button class="file-action-btn view" data-file-id="${file.fileId}">
                                      <i class="fas fa-eye"></i>
                                  </button>
                                  <button class="file-action-btn download" data-file-id="${file.fileId}">
                                      <i class="fas fa-download"></i>
                                  </button>
                                  <button class="file-action-btn delete" data-file-id="${file.fileId}">
                                      <i class="fas fa-trash-alt"></i>
                                  </button>
                              </div>
                          </div>
                      `;
                  }).join('') : `<div class="empty-message">No files found. Upload some files to get started!</div>`}
              </div>
          </main>
      </div>
      
      <!-- Mobile Upload Button -->
      <div class="mobile-upload-btn" id="mobileUploadBtn">
          <i class="fas fa-upload"></i>
      </div>
      
      <!-- Upload Modal -->
      <div class="modal" id="uploadModal">
          <div class="modal-content">
              <div class="modal-header">
                  <h3 class="modal-title">Upload File</h3>
                  <button class="close-btn" id="closeUploadBtn">&times;</button>
              </div>
              <div class="modal-body">
                  <div class="alert alert-success" id="successAlert">
                      File uploaded successfully!
                  </div>
                  <div class="alert alert-error" id="errorAlert">
                      Error uploading file. Please try again.
                  </div>
                  
                  <form id="uploadForm">
                      <div class="form-group">
                          <label for="accountSelect" class="form-label">Select Account/Bucket:</label>
                          <select id="accountSelect" name="account" class="form-select" required>
                              <option value="">-- Select Account --</option>
                              ${accountList.map(account => `<option value="${account}">${account}</option>`).join('')}
                          </select>
                      </div>
                      
                      <div class="form-group">
                          <label for="fileTitle" class="form-label">File Name:</label>
                          <input type="text" id="fileTitle" name="title" class="form-control" placeholder="Enter a name for your file" required>
                      </div>
                      
                      <div class="file-input-container">
                          <label for="fileUpload" class="file-input-label" id="fileInputLabel">
                              <div class="file-input-text">
                                  <i class="fas fa-cloud-upload-alt"></i>
                                  <span>Drag & drop file here or click to browse</span>
                                  <span class="file-name-display" id="fileNameDisplay"></span>
                              </div>
                          </label>
                          <input type="file" id="fileUpload" name="file" class="file-input" required>
                      </div>
                      
                      <button type="submit" class="submit-btn" id="uploadButton">Upload File</button>
                      
                      <div class="progress-container" id="progressContainer">
                          <div class="progress-bar-container">
                              <div class="progress-bar" id="progressBar"></div>
                          </div>
                          <div class="progress-text" id="progressText">0%</div>
                      </div>
                  </form>
              </div>
          </div>
      </div>
      
      <!-- File Viewer Modal -->
      <div class="file-viewer-modal" id="fileViewerModal">
          <div class="file-viewer-content">
              <div class="file-viewer-header">
                  <h3 class="file-viewer-title" id="fileViewerTitle">File Name</h3>
                  <button class="file-viewer-close" id="closeFileViewerBtn">&times;</button>
              </div>
              <div class="file-viewer-body" id="fileViewerBody">
                  <!-- Content will be dynamically inserted here -->
              </div>
              <div class="file-viewer-controls">
                  <a href="#" class="file-viewer-btn" id="downloadFileBtn" target="_blank">
                      <i class="fas fa-download"></i> Download
                  </a>
                  <button class="file-viewer-btn" id="shareFileBtn">
                      <i class="fas fa-share-alt"></i> Share
                  </button>
                  <button class="file-viewer-btn delete" id="deleteFileBtn">
                      <i class="fas fa-trash-alt"></i> Delete
                  </button>
              </div>
          </div>
      </div>
      
      <!-- Confirm Delete Modal -->
      <div class="confirm-modal" id="confirmDeleteModal">
          <div class="confirm-content">
              <h3 class="confirm-title">Delete File</h3>
              <p class="confirm-message">Are you sure you want to delete this file? This action cannot be undone.</p>
              <div class="confirm-buttons">
                  <button class="confirm-btn cancel" id="cancelDeleteBtn">Cancel</button>
                  <button class="confirm-btn delete" id="confirmDeleteBtn">Delete</button>
              </div>
          </div>
      </div>
      
      <!-- Toast Container -->
      <div class="toast-container" id="toastContainer"></div>
      
      <script>
          // DOM Elements
          const searchInput = document.getElementById('searchInput');
          const typeFilter = document.getElementById('typeFilter');
          const accountFilter = document.getElementById('accountFilter');
          const sortFilter = document.getElementById('sortFilter');
          const fileGrid = document.getElementById('fileGrid');
          const openUploadBtn = document.getElementById('openUploadBtn');
          const mobileUploadBtn = document.getElementById('mobileUploadBtn');
          const uploadModal = document.getElementById('uploadModal');
          const closeUploadBtn = document.getElementById('closeUploadBtn');
          const uploadForm = document.getElementById('uploadForm');
          const fileUpload = document.getElementById('fileUpload');
          const fileInputLabel = document.getElementById('fileInputLabel');
          const fileNameDisplay = document.getElementById('fileNameDisplay');
          const progressContainer = document.getElementById('progressContainer');
          const progressBar = document.getElementById('progressBar');
          const progressText = document.getElementById('progressText');
          const successAlert = document.getElementById('successAlert');
          const errorAlert = document.getElementById('errorAlert');
          const fileViewerModal = document.getElementById('fileViewerModal');
          const fileViewerTitle = document.getElementById('fileViewerTitle');
          const fileViewerBody = document.getElementById('fileViewerBody');
          const closeFileViewerBtn = document.getElementById('closeFileViewerBtn');
          const downloadFileBtn = document.getElementById('downloadFileBtn');
          const shareFileBtn = document.getElementById('shareFileBtn');
          const deleteFileBtn = document.getElementById('deleteFileBtn');
          const confirmDeleteModal = document.getElementById('confirmDeleteModal');
          const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
          const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
          const toastContainer = document.getElementById('toastContainer');
          
          // Current file being viewed
          let currentFile = null;
          
          // Open Upload Modal
          openUploadBtn.addEventListener('click', () => {
              uploadModal.style.display = 'block';
              document.body.style.overflow = 'hidden';
          });
          
          mobileUploadBtn.addEventListener('click', () => {
              uploadModal.style.display = 'block';
              document.body.style.overflow = 'hidden';
          });
          
          // Close Upload Modal
          closeUploadBtn.addEventListener('click', () => {
              uploadModal.style.display = 'none';
              document.body.style.overflow = 'auto';
          });
          
          // Close modal when clicking outside
          window.addEventListener('click', (e) => {
              if (e.target === uploadModal) {
                  uploadModal.style.display = 'none';
                  document.body.style.overflow = 'auto';
              }
              if (e.target === fileViewerModal) {
                  fileViewerModal.style.display = 'none';
                  document.body.style.overflow = 'auto';
                  // Stop video/audio if playing
                  const mediaElements = fileViewerBody.querySelectorAll('video, audio');
                  mediaElements.forEach(media => media.pause());
              }
              if (e.target === confirmDeleteModal) {
                  confirmDeleteModal.style.display = 'none';
              }
          });
          
          // File input handling
          fileUpload.addEventListener('change', () => {
              if (fileUpload.files.length > 0) {
                  const fileName = fileUpload.files[0].name;
                  fileNameDisplay.textContent = fileName;
                  fileNameDisplay.style.display = 'block';
                  fileInputLabel.classList.add('has-file');
              } else {
                  fileNameDisplay.style.display = 'none';
                  fileInputLabel.classList.remove('has-file');
              }
          });
          
          // Drag and drop handling
          ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
              fileInputLabel.addEventListener(eventName, preventDefaults, false);
          });
          
          function preventDefaults(e) {
              e.preventDefault();
              e.stopPropagation();
          }
          
          ['dragenter', 'dragover'].forEach(eventName => {
              fileInputLabel.addEventListener(eventName, () => {
                  fileInputLabel.classList.add('dragover');
              }, false);
          });
          
          ['dragleave', 'drop'].forEach(eventName => {
              fileInputLabel.addEventListener(eventName, () => {
                  fileInputLabel.classList.remove('dragover');
              }, false);
          });
          
          fileInputLabel.addEventListener('drop', (e) => {
              const dt = e.dataTransfer;
              const files = dt.files;
              fileUpload.files = files;
              
              if (files.length > 0) {
                  const fileName = files[0].name;
                  fileNameDisplay.textContent = fileName;
                  fileNameDisplay.style.display = 'block';
                  fileInputLabel.classList.add('has-file');
              }
          }, false);
          
          // Form submission
          uploadForm.addEventListener('submit', async (e) => {
              e.preventDefault();
              
              const account = document.getElementById('accountSelect').value;
              const title = document.getElementById('fileTitle').value;
              const file = document.getElementById('fileUpload').files[0];
              
              if (!account || !title || !file) {
                  showError('Please fill in all fields');
                  return;
              }
              
              // Check file size (limit to 100MB for simplicity)
              if (file.size > 1000 * 1024 * 1024) {
                  showError('File size exceeds 1000MB limit. Please choose a smaller file.');
                  return;
              }
              
              // Disable the submit button and show uploading state
              const uploadButton = document.getElementById('uploadButton');
              uploadButton.disabled = true;
              uploadButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';
              
              // Prepare form data
              const formData = new FormData();
              formData.append('account', account);
              formData.append('title', title);
              formData.append('file', file);
              
              try {
                  // Show progress
                  progressContainer.style.display = 'block';
                  
                  // Create XHR for progress tracking
                  const xhr = new XMLHttpRequest();
                  xhr.open('POST', '/upload', true);
                  
                  xhr.upload.onprogress = (e) => {
                      if (e.lengthComputable) {
                          const percentComplete = Math.round((e.loaded / e.total) * 100);
                          progressBar.style.width = percentComplete + '%';
                          progressText.textContent = percentComplete + '%';
                      }
                  };
                  
                  xhr.onload = function() {
                      if (xhr.status === 200) {
                          const response = JSON.parse(xhr.responseText);
                          showSuccess('File uploaded successfully!');
                          
                          // Reset form
                          uploadForm.reset();
                          fileNameDisplay.style.display = 'none';
                          fileInputLabel.classList.remove('has-file');
                          
                          // Show toast notification
                          showToast('success', 'File uploaded successfully!');
                          
                          // Reload the page after a short delay to show the new file
                          setTimeout(() => {
                              window.location.reload();
                          }, 2000);
                      } else {
                          showError('Error uploading file: ' + xhr.statusText);
                          showToast('error', 'Upload failed: ' + xhr.statusText);
                      }
                      
                      // Hide progress and reset button
                      progressContainer.style.display = 'none';
                      uploadButton.disabled = false;
                      uploadButton.innerHTML = 'Upload File';
                  };
                  
                  xhr.onerror = function() {
                      showError('Network error occurred');
                      showToast('error', 'Network error occurred');
                      progressContainer.style.display = 'none';
                      uploadButton.disabled = false;
                      uploadButton.innerHTML = 'Upload File';
                  };
                  
                  xhr.send(formData);
                  
              } catch (error) {
                  showError('Error: ' + error.message);
                  showToast('error', 'Error: ' + error.message);
                  progressContainer.style.display = 'none';
                  uploadButton.disabled = false;
                  uploadButton.innerHTML = 'Upload File';
              }
          });
          
          // Show success message
          function showSuccess(message) {
              successAlert.textContent = message;
              successAlert.style.display = 'block';
              errorAlert.style.display = 'none';
              
              setTimeout(() => {
                  successAlert.style.display = 'none';
              }, 5000);
          }
          
          // Show error message
          function showError(message) {
              errorAlert.textContent = message;
              errorAlert.style.display = 'block';
              successAlert.style.display = 'none';
              
              setTimeout(() => {
                  errorAlert.style.display = 'none';
              }, 5000);
          }
          
          function showToast(type, message) {
            const toast = document.createElement('div');
            toast.className = \`toast \${type}\`;
            
            const icon = type === 'success' 
                ? '<i class="fas fa-check-circle"></i>' 
                : '<i class="fas fa-exclamation-circle"></i>';
                
            toast.innerHTML = \`\${icon} <span>\${message}</span>\`;
            
            toastContainer.appendChild(toast);
            
            // Remove toast after 3 seconds
            setTimeout(() => {
                toast.remove();
            }, 3000);
        }
          
          // Filter and search functionality
          function applyFilters() {
              const searchTerm = searchInput.value.toLowerCase();
              const typeValue = typeFilter.value;
              const accountValue = accountFilter.value;
              const sortValue = sortFilter.value;
              
              const fileCards = document.querySelectorAll('.file-card');
              let visibleCount = 0;
              
              // First filter the files
              fileCards.forEach(card => {
                  const fileData = JSON.parse(card.getAttribute('data-file'));
                  const fileName = fileData.title.toLowerCase();
                  const fileType = card.getAttribute('data-type');
                  const fileAccount = fileData.account;
                  
                  const matchesSearch = fileName.includes(searchTerm);
                  const matchesType = typeValue === 'all' || fileType === typeValue;
                  const matchesAccount = accountValue === 'all' || fileAccount === accountValue;
                  
                  if (matchesSearch && matchesType && matchesAccount) {
                      card.style.display = 'block';
                      visibleCount++;
                  } else {
                      card.style.display = 'none';
                  }
              });
              
              // Then sort the visible files
              const visibleCards = Array.from(fileCards).filter(card => card.style.display !== 'none');
              
              visibleCards.sort((a, b) => {
                  const fileDataA = JSON.parse(a.getAttribute('data-file'));
                  const fileDataB = JSON.parse(b.getAttribute('data-file'));
                  
                  switch(sortValue) {
                      case 'newest':
                          return fileDataB.uploadTimestamp - fileDataA.uploadTimestamp;
                      case 'oldest':
                          return fileDataA.uploadTimestamp - fileDataB.uploadTimestamp;
                      case 'name':
                          return fileDataA.title.localeCompare(fileDataB.title);
                      case 'size':
                          return fileDataB.size - fileDataA.size;
                      default:
                          return 0;
                  }
              });
              
              // Reorder the DOM elements
              visibleCards.forEach(card => {
                  fileGrid.appendChild(card);
              });
              
              // Show empty message if no files match
              const emptyMessage = document.querySelector('.empty-message');
              if (visibleCount === 0 && !emptyMessage) {
                  const message = document.createElement('div');
                  message.className = 'empty-message';
                  message.textContent = 'No files match your search criteria.';
                  fileGrid.appendChild(message);
              } else if (visibleCount > 0 && emptyMessage) {
                  emptyMessage.remove();
              }
          }
          
          // Add event listeners for filters
          searchInput.addEventListener('input', applyFilters);
          typeFilter.addEventListener('change', applyFilters);
          accountFilter.addEventListener('change', applyFilters);
          sortFilter.addEventListener('change', applyFilters);
          
          // File action handlers
          document.addEventListener('click', (e) => {
              // View file button
              if (e.target.closest('.file-action-btn.view') || 
                  (e.target.closest('.file-card') && !e.target.closest('.file-action-btn'))) {
                  
                  const card = e.target.closest('.file-card');
                  const fileData = JSON.parse(card.getAttribute('data-file'));
                  openFileViewer(fileData);
              }
              
              // Download file button
              if (e.target.closest('.file-action-btn.download')) {
                  const card = e.target.closest('.file-card');
                  const fileData = JSON.parse(card.getAttribute('data-file'));
                  window.open(fileData.url, '_blank');
              }
              
              // Delete file button
              if (e.target.closest('.file-action-btn.delete')) {
                  const card = e.target.closest('.file-card');
                  const fileData = JSON.parse(card.getAttribute('data-file'));
                  openDeleteConfirmation(fileData);
              }
          });
          
          // Open file viewer
          function openFileViewer(fileData) {
              currentFile = fileData;
              fileViewerTitle.textContent = fileData.title;
              fileViewerBody.innerHTML = '';
              downloadFileBtn.href = fileData.url;
              
              const contentType = fileData.contentType;
              
              if (contentType.startsWith('video/')) {
                  // Simple video player for Cloudflare Worker environment
                  const video = document.createElement('video');
                  video.controls = true;
                  video.style.width = '100%';
                  video.style.maxHeight = '80vh';
                  video.style.borderRadius = '8px';
                  video.src = fileData.url;
                  fileViewerBody.appendChild(video);
              } else if (contentType.startsWith('image/')) {
                  const img = document.createElement('img');
                  img.src = fileData.url;
                  img.alt = fileData.title;
                  img.style.maxWidth = '100%';
                  img.style.maxHeight = '80vh';
                  img.style.borderRadius = '8px';
                  fileViewerBody.appendChild(img);
              } else if (contentType.startsWith('audio/')) {
                  const audio = document.createElement('audio');
                  audio.controls = true;
                  audio.style.width = '100%';
                  audio.style.margin = '20px 0';
                  audio.src = fileData.url;
                  fileViewerBody.appendChild(audio);
              } else {
                    // For other file types, show a download prompt
                    fileViewerBody.innerHTML = 
                        '<div style="padding: 40px; text-align: center;">' +
                            '<i class="fas fa-file-alt" style="font-size: 4rem; color: var(--accent-color); margin-bottom: 20px;"></i>' +
                            '<p>This file type cannot be previewed directly.</p>' +
                            '<p>Click the download button below to access the file.</p>' +
                        '</div>';
              }
              
              fileViewerModal.style.display = 'block';
              document.body.style.overflow = 'hidden';
          }
          
          // Close file viewer
          closeFileViewerBtn.addEventListener('click', () => {
              fileViewerModal.style.display = 'none';
              document.body.style.overflow = 'auto';
              // Stop video/audio if playing
              const mediaElements = fileViewerBody.querySelectorAll('video, audio');
              mediaElements.forEach(media => media.pause());
          });
          
          // Share button functionality
          shareFileBtn.addEventListener('click', () => {
              const fileUrl = downloadFileBtn.href;
              const fileName = fileViewerTitle.textContent;
              
              if (navigator.share) {
                  navigator.share({
                      title: fileName,
                      url: fileUrl
                  }).catch(err => {
                      console.error('Share failed:', err);
                      copyToClipboard(fileUrl);
                  });
              } else {
                  copyToClipboard(fileUrl);
              }
          });
          
          // Copy URL to clipboard
          function copyToClipboard(text) {
              const textarea = document.createElement('textarea');
              textarea.value = text;
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand('copy');
              document.body.removeChild(textarea);
              showToast('success', 'Link copied to clipboard!');
          }
          
          // Delete file functionality
          deleteFileBtn.addEventListener('click', () => {
              if (currentFile) {
                  openDeleteConfirmation(currentFile);
              }
          });
          
          // Open delete confirmation modal
          function openDeleteConfirmation(fileData) {
              currentFile = fileData;
              confirmDeleteModal.style.display = 'block';
          }
          
          // Cancel delete
          cancelDeleteBtn.addEventListener('click', () => {
              confirmDeleteModal.style.display = 'none';
          });
          
          // Confirm delete
          confirmDeleteBtn.addEventListener('click', async () => {
              if (!currentFile) return;
              
              confirmDeleteBtn.disabled = true;
              confirmDeleteBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';
              
              try {
                  const response = await fetch('/delete-file', {
                      method: 'POST',
                      headers: {
                          'Content-Type': 'application/json'
                      },
                      body: JSON.stringify({
                          account: currentFile.account,
                          fileId: currentFile.fileId,
                          fileName: currentFile.fullFileName
                      })
                  });
                  
                  if (response.ok) {
                      showToast('success', 'File deleted successfully!');
                      
                      // Close modals
                      confirmDeleteModal.style.display = 'none';
                      fileViewerModal.style.display = 'none';
                      document.body.style.overflow = 'auto';
                      
                      // Remove the file card from the grid
                      const fileCards = document.querySelectorAll('.file-card');
                      fileCards.forEach(card => {
                          const fileData = JSON.parse(card.getAttribute('data-file'));
                          if (fileData.fileId === currentFile.fileId) {
                              card.remove();
                          }
                      });
                      
                      // Check if grid is empty
                      if (fileGrid.children.length === 0) {
                          const emptyMessage = document.createElement('div');
                          emptyMessage.className = 'empty-message';
                          emptyMessage.textContent = 'No files found. Upload some files to get started!';
                          fileGrid.appendChild(emptyMessage);
                      }
                      
                  } else {
                      const error = await response.json();
                      showToast('error', 'Error deleting file: ' + error.message);
                  }
              } catch (error) {
                  showToast('error', 'Error deleting file: ' + error.message);
              }
              
              confirmDeleteBtn.disabled = false;
              confirmDeleteBtn.innerHTML = 'Delete';
          });
          
          // Initialize filters
          applyFilters();
      </script>
  </body>
  </html>`;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});