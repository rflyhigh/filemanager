document.addEventListener('DOMContentLoaded', function() {
  // Upload modal functionality
  const uploadBtn = document.getElementById('uploadBtn');
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
  const uploadQueueContainer = document.getElementById('uploadQueueContainer');
  const uploadQueue = document.getElementById('uploadQueue');
  
  // Create folder modal functionality
  const createFolderBtn = document.getElementById('createFolderBtn');
  const folderModal = document.getElementById('folderModal');
  const closeFolderBtn = document.getElementById('closeFolderBtn');
  const folderForm = document.getElementById('folderForm');
  const folderSuccessAlert = document.getElementById('folderSuccessAlert');
  const folderErrorAlert = document.getElementById('folderErrorAlert');
  
  // Rename modal functionality
  const renameModal = document.getElementById('renameModal');
  const closeRenameBtn = document.getElementById('closeRenameBtn');
  const renameForm = document.getElementById('renameForm');
  const renameSuccessAlert = document.getElementById('renameSuccessAlert');
  const renameErrorAlert = document.getElementById('renameErrorAlert');
  
  // Delete modal functionality
  const deleteModal = document.getElementById('deleteModal');
  const closeDeleteBtn = document.getElementById('closeDeleteBtn');
  const cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
  const confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
  
  // Move files modal functionality
  const moveFilesBtn = document.getElementById('moveFilesBtn');
  const moveModal = document.getElementById('moveModal');
  const closeMoveBtn = document.getElementById('closeMoveBtn');
  const cancelMoveBtn = document.getElementById('cancelMoveBtn');
  const confirmMoveBtn = document.getElementById('confirmMoveBtn');
  const folderTree = document.getElementById('folderTree');
  const moveSuccessAlert = document.getElementById('moveSuccessAlert');
  const moveErrorAlert = document.getElementById('moveErrorAlert');
  
  // File selection functionality
  const selectAllBtn = document.getElementById('selectAllBtn');
  const deselectAllBtn = document.getElementById('deselectAllBtn');
  const selectedCount = document.getElementById('selectedCount');
  
  // View toggle functionality
  const viewBtns = document.querySelectorAll('.view-btn');
  const fileGrid = document.getElementById('fileGrid');
  
  // Filter functionality
  const typeFilter = document.getElementById('typeFilter');
  const sortFilter = document.getElementById('sortFilter');
  
  // Quick upload button
  const quickUploadBtn = document.getElementById('quickUploadBtn');
  
  // Player options
  const autoplayToggle = document.getElementById('autoplayOption');
  const loopToggle = document.getElementById('loopOption');
  
  // Player.js functionality
  let player;
  
  if (window.playerInstance) {
    player = window.playerInstance;
    
    // Set up event listeners for player
    if (autoplayToggle) {
      autoplayToggle.addEventListener('change', function() {
        localStorage.setItem('autoplay', this.checked);
        if (this.checked) {
          player.play();
        } else {
          player.pause();
        }
      });
      
      // Set from localStorage
      const savedAutoplay = localStorage.getItem('autoplay') === 'true';
      if (savedAutoplay) {
        autoplayToggle.checked = true;
        player.play();
      }
    }
    
    if (loopToggle) {
      loopToggle.addEventListener('change', function() {
        localStorage.setItem('loop', this.checked);
        player.setLoop(this.checked);
      });
      
      // Set from localStorage
      const savedLoop = localStorage.getItem('loop') === 'true';
      if (savedLoop) {
        loopToggle.checked = true;
        player.setLoop(true);
      }
    }
  }
  
  // Upload queue
  const uploadQueueList = [];
  let isUploading = false;
  
  // Open upload modal
  if (uploadBtn) {
    uploadBtn.addEventListener('click', function() {
      uploadModal.style.display = 'block';
      loadFolders();
    });
  }
  
  // Quick upload button
  if (quickUploadBtn) {
    quickUploadBtn.addEventListener('click', function() {
      uploadModal.style.display = 'block';
      loadFolders();
    });
  }
  
  // Close upload modal - handle all instances of closeUploadBtn
  const closeUploadBtns = document.querySelectorAll('#closeUploadBtn');
  closeUploadBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      uploadModal.style.display = 'none';
    });
  });
  
  // Open create folder modal
  if (createFolderBtn) {
    createFolderBtn.addEventListener('click', function() {
      folderModal.style.display = 'block';
      loadParentFolders();
    });
  }
  
  // Close create folder modal - handle all instances of closeFolderBtn
  const closeFolderBtns = document.querySelectorAll('#closeFolderBtn');
  closeFolderBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      folderModal.style.display = 'none';
    });
  });
  
  // Close rename modal - handle all instances of closeRenameBtn
  const closeRenameBtns = document.querySelectorAll('#closeRenameBtn');
  closeRenameBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      renameModal.style.display = 'none';
    });
  });
  
  // Close delete modal
  if (closeDeleteBtn) {
    closeDeleteBtn.addEventListener('click', function() {
      deleteModal.style.display = 'none';
    });
  }
  
  // Cancel delete
  if (cancelDeleteBtn) {
    cancelDeleteBtn.addEventListener('click', function() {
      deleteModal.style.display = 'none';
    });
  }
  
  // Open move files modal
  if (moveFilesBtn) {
    moveFilesBtn.addEventListener('click', function() {
      const selectedFiles = getSelectedFiles();
      if (selectedFiles.length === 0) {
        showToast('error', 'Please select files to move');
        return;
      }
      
      moveModal.style.display = 'block';
      loadFolderTree();
    });
  }
  
  // Close move files modal - handle all instances of closeMoveBtn
  const closeMoveBtns = document.querySelectorAll('#closeMoveBtn');
  closeMoveBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      moveModal.style.display = 'none';
    });
  });
  
  // Cancel move
  if (cancelMoveBtn) {
    cancelMoveBtn.addEventListener('click', function() {
      moveModal.style.display = 'none';
    });
  }
  
  // Close modals when clicking outside
  window.addEventListener('click', function(event) {
    if (event.target === uploadModal) {
      uploadModal.style.display = 'none';
    }
    if (event.target === folderModal) {
      folderModal.style.display = 'none';
    }
    if (event.target === renameModal) {
      renameModal.style.display = 'none';
    }
    if (event.target === deleteModal) {
      deleteModal.style.display = 'none';
    }
    if (event.target === moveModal) {
      moveModal.style.display = 'none';
    }
  });
  
  // File input handling
  if (fileUpload) {
    fileUpload.addEventListener('change', function() {
      if (fileUpload.files.length > 0) {
        // Show all selected files
        let fileNames = '';
        for (let i = 0; i < fileUpload.files.length; i++) {
          fileNames += fileUpload.files[i].name + '<br>';
        }
        fileNameDisplay.innerHTML = fileNames;
        fileNameDisplay.style.display = 'block';
      } else {
        fileNameDisplay.style.display = 'none';
      }
    });
    
    // Set multiple attribute
    fileUpload.setAttribute('multiple', 'multiple');
  }
  
  // Drag and drop handling
  if (fileInputLabel) {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      fileInputLabel.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
      e.preventDefault();
      e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
      fileInputLabel.addEventListener(eventName, function() {
        fileInputLabel.classList.add('dragover');
      }, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
      fileInputLabel.addEventListener(eventName, function() {
        fileInputLabel.classList.remove('dragover');
      }, false);
    });
    
    fileInputLabel.addEventListener('drop', function(e) {
      const dt = e.dataTransfer;
      const files = dt.files;
      
      if (files.length > 0) {
        fileUpload.files = files;
        
        // Show all dropped files
        let fileNames = '';
        for (let i = 0; i < files.length; i++) {
          fileNames += files[i].name + '<br>';
        }
        fileNameDisplay.innerHTML = fileNames;
        fileNameDisplay.style.display = 'block';
      }
    }, false);
  }
  
  // Form submission for file upload
  if (uploadForm) {
    uploadForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      const account = document.getElementById('accountSelect').value;
      const title = document.getElementById('fileTitle').value;
      const folderId = document.getElementById('folderSelect').value;
      const files = document.getElementById('fileUpload').files;
      
      if (!account || !files.length) {
        showAlert('error', 'Please select an account and at least one file');
        return;
      }
      
      // Add all files to upload queue
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Check file size (limit to 1000MB)
        if (file.size > 1000 * 1024 * 1024) {
          showAlert('error', `File ${file.name} exceeds 1000MB limit. Skipping.`);
          continue;
        }
        
        // Generate title from filename if not provided
        let fileTitle = title;
        if (!fileTitle) {
          fileTitle = file.name.replace(/\.[^/.]+$/, ""); // Remove file extension
        }
        
        // Add to upload queue
        addToUploadQueue(file, fileTitle, account, folderId);
      }
      
      // Reset form
      uploadForm.reset();
      fileNameDisplay.style.display = 'none';
      
      // Show success message
      showAlert('success', `${files.length} file(s) added to upload queue`);
      
      // Process queue if not already uploading
      if (!isUploading) {
        processUploadQueue();
      }
    });
  }
  
  // Form submission for folder creation
  if (folderForm) {
    folderForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const name = document.getElementById('folderName').value;
      const parent = document.getElementById('parentFolderSelect').value;
      
      if (!name) {
        showFolderAlert('error', 'Please enter a folder name');
        return;
      }
      
      // Get the account from the URL or default to account1
      const account = document.getElementById('folderAccountSelect') ? 
                      document.getElementById('folderAccountSelect').value : 'account1';
      
      // Disable the submit button
      const submitBtn = document.getElementById('createFolderSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Creating...';
      
      try {
        const response = await fetch('/api/folders', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name,
            account,
            parent: parent === 'null' ? null : parent
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to create folder');
        }
        
        const result = await response.json();
        
        showFolderAlert('success', 'Folder created successfully');
        showToast('success', 'Folder created successfully');
        
        // Reset form
        folderForm.reset();
        
        // Reload the page after a short delay
        setTimeout(function() {
          window.location.reload();
        }, 1500);
        
      } catch (error) {
        showFolderAlert('error', 'Error: ' + error.message);
        showToast('error', 'Error: ' + error.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Create Folder';
      }
    });
  }
  
  // Form submission for rename
  if (renameForm) {
    renameForm.addEventListener('submit', async function(e) {
      e.preventDefault();
      
      const itemId = document.getElementById('renameItemId').value;
      const itemType = document.getElementById('renameItemType').value;
      const newName = document.getElementById('newName').value;
      
      if (!itemId || !itemType || !newName) {
        showRenameAlert('error', 'Please fill in all required fields');
        return;
      }
      
      // Disable the submit button
      const submitBtn = document.getElementById('renameSubmitBtn');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Renaming...';
      
      try {
        let url, method, body;
        
        if (itemType === 'file') {
          url = '/api/files/rename';
          method = 'POST';
          body = {
            fileId: itemId,
            newTitle: newName
          };
        } else if (itemType === 'folder') {
          url = `/api/folders/${itemId}`;
          method = 'PUT';
          body = {
            name: newName
          };
        } else {
          throw new Error('Invalid item type');
        }
        
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to rename item');
        }
        
        showRenameAlert('success', 'Item renamed successfully');
        showToast('success', 'Item renamed successfully');
        
        // Reload the page after a short delay
        setTimeout(function() {
          window.location.reload();
        }, 1500);
        
      } catch (error) {
        showRenameAlert('error', 'Error: ' + error.message);
        showToast('error', 'Error: ' + error.message);
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Rename';
      }
    });
  }
  
  // Confirm delete button
  if (confirmDeleteBtn) {
    confirmDeleteBtn.addEventListener('click', async function() {
      const itemId = this.getAttribute('data-id');
      const itemType = this.getAttribute('data-type');
      
      if (!itemId || !itemType) {
        showToast('error', 'Missing item information');
        return;
      }
      
      // Disable the button
      confirmDeleteBtn.disabled = true;
      confirmDeleteBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Deleting...';
      
      try {
        let url, method, body;
        
        if (itemType === 'file') {
          url = '/api/files/delete';
          method = 'POST';
          body = {
            fileId: itemId
          };
        } else if (itemType === 'folder') {
          url = `/api/folders/${itemId}`;
          method = 'DELETE';
          body = {};
        } else {
          throw new Error('Invalid item type');
        }
        
        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to delete item');
        }
        
        showToast('success', 'Item deleted successfully');
        
        // Close the modal
        deleteModal.style.display = 'none';
        
        // Reload the page after a short delay
        setTimeout(function() {
          window.location.reload();
        }, 1000);
        
      } catch (error) {
        showToast('error', 'Error: ' + error.message);
      } finally {
        confirmDeleteBtn.disabled = false;
        confirmDeleteBtn.innerHTML = 'Delete';
      }
    });
  }
  
  // Confirm move button
  if (confirmMoveBtn) {
    confirmMoveBtn.addEventListener('click', async function() {
      const selectedFiles = getSelectedFiles();
      if (selectedFiles.length === 0) {
        showMoveAlert('error', 'No files selected');
        return;
      }
      
      const selectedFolder = document.querySelector('.folder-tree-item.selected');
      if (!selectedFolder) {
        showMoveAlert('error', 'Please select a destination folder');
        return;
      }
      
      const folderId = selectedFolder.getAttribute('data-id');
      
      // Disable the button
      confirmMoveBtn.disabled = true;
      confirmMoveBtn.innerHTML = '<span class="material-icons">hourglass_empty</span> Moving...';
      
      try {
        const response = await fetch('/api/files/move', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fileIds: selectedFiles,
            folderId: folderId
          })
        });
        
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to move files');
        }
        
        const result = await response.json();
        
        showMoveAlert('success', `${result.count} files moved successfully`);
        showToast('success', `${result.count} files moved successfully`);
        
        // Close the modal
        moveModal.style.display = 'none';
        
        // Reload the page after a short delay
        setTimeout(function() {
          window.location.reload();
        }, 1500);
        
      } catch (error) {
        showMoveAlert('error', 'Error: ' + error.message);
        showToast('error', 'Error: ' + error.message);
      } finally {
        confirmMoveBtn.disabled = false;
        confirmMoveBtn.innerHTML = 'Move';
      }
    });
  }
  
  // File selection
  if (fileGrid) {
    // Add click event to file checkboxes
    fileGrid.addEventListener('change', function(e) {
      if (e.target.classList.contains('file-select')) {
        const fileCard = e.target.closest('.file-card');
        if (fileCard) {
          if (e.target.checked) {
            fileCard.classList.add('selected');
          } else {
            fileCard.classList.remove('selected');
          }
          
          updateSelectedCount();
        }
      }
    });
  }
  
  // Select all button
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', function() {
      const checkboxes = document.querySelectorAll('.file-select');
      checkboxes.forEach(checkbox => {
        checkbox.checked = true;
        const fileCard = checkbox.closest('.file-card');
        if (fileCard) {
          fileCard.classList.add('selected');
        }
      });
      
      updateSelectedCount();
      selectAllBtn.style.display = 'none';
      deselectAllBtn.style.display = 'inline-flex';
    });
  }
  
  // Deselect all button
  if (deselectAllBtn) {
    deselectAllBtn.addEventListener('click', function() {
      const checkboxes = document.querySelectorAll('.file-select');
      checkboxes.forEach(checkbox => {
        checkbox.checked = false;
        const fileCard = checkbox.closest('.file-card');
        if (fileCard) {
          fileCard.classList.remove('selected');
        }
      });
      
      updateSelectedCount();
      selectAllBtn.style.display = 'inline-flex';
      deselectAllBtn.style.display = 'none';
    });
  }
  
  // View toggle
  if (viewBtns.length > 0) {
    viewBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        viewBtns.forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        
        const view = this.getAttribute('data-view');
        if (view === 'grid') {
          fileGrid.classList.remove('list-view');
        } else {
          fileGrid.classList.add('list-view');
        }
      });
    });
  }
  
  // Type filter
  if (typeFilter) {
    typeFilter.addEventListener('change', function() {
      applyFilters();
    });
  }
  
  // Sort filter
  if (sortFilter) {
    sortFilter.addEventListener('change', function() {
      applyFilters();
    });
  }
  
  // Add to upload queue
  function addToUploadQueue(file, title, account, folderId) {
    const queueItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      file,
      title,
      account,
      folderId,
      progress: 0,
      status: 'queued'
    };
    
    uploadQueueList.push(queueItem);
    renderUploadQueue();
    
    // Show the queue container
    if (uploadQueueContainer) {
      uploadQueueContainer.style.display = 'block';
    }
  }
  
  // Render upload queue
  function renderUploadQueue() {
    if (!uploadQueue) return;
    
    uploadQueue.innerHTML = '';
    
    if (uploadQueueList.length === 0) {
      uploadQueue.innerHTML = '<div class="empty-message">No files in queue</div>';
      return;
    }
    
    uploadQueueList.forEach(item => {
      const queueItem = document.createElement('div');
      queueItem.className = 'queue-item';
      queueItem.dataset.id = item.id;
      
      let statusText = 'Queued';
      let statusClass = '';
      
      if (item.status === 'uploading') {
        statusText = `Uploading (${item.progress}%)`;
        statusClass = 'uploading';
      } else if (item.status === 'completed') {
        statusText = 'Completed';
        statusClass = 'completed';
      } else if (item.status === 'error') {
        statusText = 'Error';
        statusClass = 'error';
      }
      
      queueItem.innerHTML = `
        <div class="queue-item-info">
          <div class="queue-item-name">${item.title}</div>
          <div class="queue-item-progress">
            <div class="queue-item-progress-bar" style="width: ${item.progress}%"></div>
          </div>
          <div class="queue-item-status ${statusClass}">${statusText}</div>
        </div>
        <div class="queue-item-actions">
          ${item.status !== 'completed' ? `
            <button class="queue-item-cancel" data-id="${item.id}">
              <span class="material-icons">cancel</span>
            </button>
          ` : ''}
        </div>
      `;
      
      uploadQueue.appendChild(queueItem);
    });
    
    // Add event listeners to cancel buttons
    document.querySelectorAll('.queue-item-cancel').forEach(btn => {
      btn.addEventListener('click', function() {
        const id = this.getAttribute('data-id');
        removeFromUploadQueue(id);
      });
    });
  }
  
  // Remove from upload queue
  function removeFromUploadQueue(id) {
    const index = uploadQueueList.findIndex(item => item.id === id);
    
    if (index !== -1) {
      uploadQueueList.splice(index, 1);
      renderUploadQueue();
      
      // Hide the queue container if empty
      if (uploadQueueList.length === 0 && uploadQueueContainer) {
        uploadQueueContainer.style.display = 'none';
      }
    }
  }
  
  // Process upload queue
  async function processUploadQueue() {
    if (uploadQueueList.length === 0 || isUploading) {
      return;
    }
    
    isUploading = true;
    const item = uploadQueueList[0];
    item.status = 'uploading';
    renderUploadQueue();
    
    try {
      // Show progress
      if (progressContainer) {
        progressContainer.style.display = 'block';
        progressBar.style.width = '0%';
        progressText.textContent = '0%';
      }
      
      // Prepare form data
      const formData = new FormData();
      formData.append('account', item.account);
      formData.append('title', item.title);
      formData.append('folderId', item.folderId);
      formData.append('file', item.file);
      
      // Create XHR for progress tracking
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/upload', true);
      
      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          const percentComplete = Math.round((e.loaded / e.total) * 100);
          
          if (progressBar) {
            progressBar.style.width = percentComplete + '%';
            progressText.textContent = percentComplete + '%';
          }
          
          item.progress = percentComplete;
          renderUploadQueue();
        }
      };
      
      xhr.onload = function() {
        if (xhr.status === 201) {
          const response = JSON.parse(xhr.responseText);
          showAlert('success', 'File uploaded successfully!');
          showToast('success', 'File uploaded successfully!');
          
          item.status = 'completed';
          renderUploadQueue();
          
          // Hide progress
          if (progressContainer) {
            progressContainer.style.display = 'none';
          }
          
          // Remove from queue after a delay
          setTimeout(function() {
            removeFromUploadQueue(item.id);
            
            // Process next item in queue
            isUploading = false;
            processUploadQueue();
          }, 3000);
        } else {
          const error = xhr.statusText || 'Upload failed';
          showAlert('error', 'Error uploading file: ' + error);
          showToast('error', 'Upload failed: ' + error);
          
          item.status = 'error';
          renderUploadQueue();
          
          // Hide progress
          if (progressContainer) {
            progressContainer.style.display = 'none';
          }
          
          // Process next item in queue
          isUploading = false;
          processUploadQueue();
        }
      };
      
      xhr.onerror = function() {
        showAlert('error', 'Network error occurred');
        showToast('error', 'Network error occurred');
        
        item.status = 'error';
        renderUploadQueue();
        
        // Hide progress
        if (progressContainer) {
          progressContainer.style.display = 'none';
        }
        
        // Process next item in queue
        isUploading = false;
        processUploadQueue();
      };
      
      xhr.send(formData);
      
    } catch (error) {
      showAlert('error', 'Error: ' + error.message);
      showToast('error', 'Error: ' + error.message);
      
      item.status = 'error';
      renderUploadQueue();
      
      // Hide progress
      if (progressContainer) {
        progressContainer.style.display = 'none';
      }
      
      // Process next item in queue
      isUploading = false;
      processUploadQueue();
    }
  }
  
  // Load folders for upload modal
  async function loadFolders() {
    const folderSelect = document.getElementById('folderSelect');
    const accountSelect = document.getElementById('accountSelect');
    
    if (!folderSelect || !accountSelect) return;
    
    // Clear existing options except the first two
    while (folderSelect.options.length > 2) {
      folderSelect.remove(2);
    }
    
    // Get selected account
    const account = accountSelect.value;
    if (!account) return;
    
    try {
      const response = await fetch(`/api/folders?account=${account}`);
      const folders = await response.json();
      
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder._id;
        option.textContent = folder.name;
        folderSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading folders:', error);
    }
  }
  
  // Load parent folders for folder creation
  async function loadParentFolders() {
    const parentFolderSelect = document.getElementById('parentFolderSelect');
    
    if (!parentFolderSelect) return;
    
    // Clear existing options except the first one
    while (parentFolderSelect.options.length > 1) {
      parentFolderSelect.remove(1);
    }
    
    try {
      const response = await fetch('/api/folders');
      const folders = await response.json();
      
      folders.forEach(folder => {
        const option = document.createElement('option');
        option.value = folder._id;
        option.textContent = folder.name;
        parentFolderSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading parent folders:', error);
    }
  }
  
  // Load folder tree for move modal
  async function loadFolderTree() {
    if (!folderTree) return;
    
    // Clear existing items except the root
    while (folderTree.children.length > 1) {
      folderTree.removeChild(folderTree.lastChild);
    }
    
    try {
      const response = await fetch('/api/folders');
      const folders = await response.json();
      
      folders.forEach(folder => {
        const folderItem = document.createElement('div');
        folderItem.className = 'folder-tree-item';
        folderItem.dataset.id = folder._id;
        
        folderItem.innerHTML = `
          <span class="material-icons">folder</span>
          <span>${folder.name}</span>
        `;
        
        folderTree.appendChild(folderItem);
      });
      
      // Add click event to folder tree items
      document.querySelectorAll('.folder-tree-item').forEach(item => {
        item.addEventListener('click', function() {
          document.querySelectorAll('.folder-tree-item').forEach(i => {
            i.classList.remove('selected');
          });
          this.classList.add('selected');
        });
      });
      
      // Select the root by default
      document.querySelector('.folder-tree-item').classList.add('selected');
      
    } catch (error) {
      console.error('Error loading folder tree:', error);
      folderTree.innerHTML = '<div class="error-message">Error loading folders</div>';
    }
  }
  
  // Update account select change event
  const accountSelect = document.getElementById('accountSelect');
  if (accountSelect) {
    accountSelect.addEventListener('change', loadFolders);
  }
  
  // Get selected files
  function getSelectedFiles() {
    const selectedCheckboxes = document.querySelectorAll('.file-select:checked');
    return Array.from(selectedCheckboxes).map(checkbox => checkbox.getAttribute('data-id'));
  }
  
  // Update selected count
  function updateSelectedCount() {
    if (!selectedCount || !moveFilesBtn) return;
    
    const count = document.querySelectorAll('.file-select:checked').length;
    
    if (count > 0) {
      selectedCount.textContent = `${count} selected`;
      selectedCount.style.display = 'inline-block';
      moveFilesBtn.disabled = false;
    } else {
      selectedCount.style.display = 'none';
      moveFilesBtn.disabled = true;
    }
  }
  
  // Apply filters to files
  function applyFilters() {
    if (!fileGrid || !typeFilter || !sortFilter) return;
    
    const type = typeFilter.value;
    const sort = sortFilter.value;
    
    // Get all visible file cards
    const fileCards = Array.from(fileGrid.querySelectorAll('.file-card'));
    
    // Filter by type
    fileCards.forEach(card => {
      if (type === 'all' || card.getAttribute('data-type') === type) {
        card.style.display = '';
      } else {
        card.style.display = 'none';
      }
    });
    
    // Get visible cards for sorting
    const visibleCards = fileCards.filter(card => card.style.display !== 'none');
    
    // Sort cards
    visibleCards.sort((a, b) => {
      const aTitle = a.querySelector('.file-name').textContent;
      const bTitle = b.querySelector('.file-name').textContent;
      const aSize = parseInt(a.getAttribute('data-size') || 0);
      const bSize = parseInt(b.getAttribute('data-size') || 0);
      const aDate = parseInt(a.getAttribute('data-timestamp') || 0);
      const bDate = parseInt(b.getAttribute('data-timestamp') || 0);
      
      switch (sort) {
        case 'name':
          return aTitle.localeCompare(bTitle);
        case 'size':
          return bSize - aSize;
        case 'oldest':
          return aDate - bDate;
        default: // newest
          return bDate - aDate;
      }
    });
    
    // Reorder the DOM
    visibleCards.forEach(card => {
      fileGrid.appendChild(card);
    });
  }
  
  // Show alert in upload modal
  function showAlert(type, message) {
    if (!successAlert || !errorAlert) return;
    
    if (type === 'success') {
      successAlert.textContent = message;
      successAlert.style.display = 'block';
      errorAlert.style.display = 'none';
      
      setTimeout(function() {
        successAlert.style.display = 'none';
      }, 5000);
    } else {
      errorAlert.textContent = message;
      errorAlert.style.display = 'block';
      successAlert.style.display = 'none';
      
      setTimeout(function() {
        errorAlert.style.display = 'none';
      }, 5000);
    }
  }
  
  // Show alert in folder modal
  function showFolderAlert(type, message) {
    if (!folderSuccessAlert || !folderErrorAlert) return;
    
    if (type === 'success') {
      folderSuccessAlert.textContent = message;
      folderSuccessAlert.style.display = 'block';
      folderErrorAlert.style.display = 'none';
      
      setTimeout(function() {
        folderSuccessAlert.style.display = 'none';
      }, 5000);
    } else {
      folderErrorAlert.textContent = message;
      folderErrorAlert.style.display = 'block';
      folderSuccessAlert.style.display = 'none';
      
      setTimeout(function() {
        folderErrorAlert.style.display = 'none';
      }, 5000);
    }
  }
  
  // Show alert in rename modal
  function showRenameAlert(type, message) {
    if (!renameSuccessAlert || !renameErrorAlert) return;
    
    if (type === 'success') {
      renameSuccessAlert.textContent = message;
      renameSuccessAlert.style.display = 'block';
      renameErrorAlert.style.display = 'none';
      
      setTimeout(function() {
        renameSuccessAlert.style.display = 'none';
      }, 5000);
    } else {
      renameErrorAlert.textContent = message;
      renameErrorAlert.style.display = 'block';
      renameSuccessAlert.style.display = 'none';
      
      setTimeout(function() {
        renameErrorAlert.style.display = 'none';
      }, 5000);
    }
  }
  
  // Show alert in move modal
  function showMoveAlert(type, message) {
    if (!moveSuccessAlert || !moveErrorAlert) return;
    
    if (type === 'success') {
      moveSuccessAlert.textContent = message;
      moveSuccessAlert.style.display = 'block';
      moveErrorAlert.style.display = 'none';
      
      setTimeout(function() {
        moveSuccessAlert.style.display = 'none';
      }, 5000);
    } else {
      moveErrorAlert.textContent = message;
      moveErrorAlert.style.display = 'block';
      moveSuccessAlert.style.display = 'none';
      
      setTimeout(function() {
        moveErrorAlert.style.display = 'none';
      }, 5000);
    }
  }
  
  // Show toast notification
  function showToast(type, message) {
    const toastContainer = document.getElementById('toastContainer');
    
    if (!toastContainer) return;
    
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    
    const icon = type === 'success' 
      ? '<span class="material-icons">check_circle</span>' 
      : '<span class="material-icons">error</span>';
    
    toast.innerHTML = icon + '<span>' + message + '</span>';
    
    toastContainer.appendChild(toast);
    
    // Remove toast after 3 seconds
    setTimeout(function() {
      toast.style.opacity = '0';
      setTimeout(function() {
        toast.remove();
      }, 300);
    }, 3000);
  }
  
  // Initialize
  document.addEventListener('click', function(e) {
    // Rename file button
    if (e.target.closest('.rename-file')) {
      const btn = e.target.closest('.rename-file');
      const fileId = btn.getAttribute('data-id');
      const title = btn.getAttribute('data-title');
      
      document.getElementById('renameModalTitle').textContent = 'Rename File';
      document.getElementById('renameItemId').value = fileId;
      document.getElementById('renameItemType').value = 'file';
      document.getElementById('newName').value = title;
      
      renameModal.style.display = 'block';
    }
    
    // Rename folder button
    if (e.target.closest('.rename-folder')) {
      const btn = e.target.closest('.rename-folder');
      const folderId = btn.getAttribute('data-id');
      const name = btn.getAttribute('data-name');
      
      document.getElementById('renameModalTitle').textContent = 'Rename Folder';
      document.getElementById('renameItemId').value = folderId;
      document.getElementById('renameItemType').value = 'folder';
      document.getElementById('newName').value = name;
      
      renameModal.style.display = 'block';
    }
    
    // Delete file button
    if (e.target.closest('.delete-file')) {
      const btn = e.target.closest('.delete-file');
      const fileId = btn.getAttribute('data-id');
      
      document.getElementById('deleteModalTitle').textContent = 'Delete File';
      document.getElementById('deleteModalMessage').textContent = 'Are you sure you want to delete this file? This action cannot be undone.';
      
      confirmDeleteBtn.setAttribute('data-id', fileId);
      confirmDeleteBtn.setAttribute('data-type', 'file');
      
      deleteModal.style.display = 'block';
    }
    
    // Delete folder button
    if (e.target.closest('.delete-folder')) {
      const btn = e.target.closest('.delete-folder');
      const folderId = btn.getAttribute('data-id');
      
      document.getElementById('deleteModalTitle').textContent = 'Delete Folder';
      document.getElementById('deleteModalMessage').textContent = 'Are you sure you want to delete this folder? This action cannot be undone.';
      
      confirmDeleteBtn.setAttribute('data-id', folderId);
      confirmDeleteBtn.setAttribute('data-type', 'folder');
      
      deleteModal.style.display = 'block';
    }
  });
  
  // Start processing the upload queue if there are items
  if (uploadQueueList.length > 0 && !isUploading) {
    processUploadQueue();
  }
});

// Global function to show toast notifications
function showToast(type, message) {
  const toastContainer = document.getElementById('toastContainer');
  
  if (!toastContainer) return;
  
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  
  const icon = type === 'success' 
    ? '<span class="material-icons">check_circle</span>' 
    : '<span class="material-icons">error</span>';
  
  toast.innerHTML = icon + '<span>' + message + '</span>';
  
  toastContainer.appendChild(toast);
  
  // Remove toast after 3 seconds
  setTimeout(function() {
    toast.style.opacity = '0';
    setTimeout(function() {
      toast.remove();
    }, 300);
  }, 3000);
}