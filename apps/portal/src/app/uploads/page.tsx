'use client';

import { useState, useEffect } from 'react';
import { api, getStoredConfig, type TenantSettings } from '@/lib/api-client';

interface Upload {
  id: string;
  objectKey: string;
  originalFileName: string;
  sizeBytes: number;
  mimeType: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface UploadProgress {
  file: File;
  status: 'pending' | 'presigning' | 'uploading' | 'completing' | 'success' | 'error';
  progress: number;
  error?: string;
  uploadId?: string;
}

export default function UploadsPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    const config = getStoredConfig();
    if (!config) {
      setLoading(false);
      return;
    }

    try {
      const [settingsData, uploadsData] = await Promise.all([
        api.getSettings(),
        api.listUploads(),
      ]);
      setSettings(settingsData);
      setUploads(uploadsData.uploads);
    } catch (error: any) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    if (!settings) {
      alert('Please configure settings first');
      return;
    }

    // Initialize progress for all files
    const newProgress: UploadProgress[] = files.map((file) => ({
      file,
      status: 'pending',
      progress: 0,
    }));
    
    // Add new progress items and get starting indices
    setUploadProgress((prev) => {
      const startIndex = prev.length;
      const allProgress = [...prev, ...newProgress];
      
      // Upload each file asynchronously
      files.forEach((file, i) => {
        const progressIndex = startIndex + i;
        uploadFile(file, progressIndex);
      });
      
      return allProgress;
    });

    // Clear file input
    e.target.value = '';
  };

  const uploadFile = async (file: File, progressIndex: number) => {
    const updateProgress = (updates: Partial<UploadProgress>) => {
      setUploadProgress((prev) => {
        const newProgress = [...prev];
        if (newProgress[progressIndex]) {
          newProgress[progressIndex] = { ...newProgress[progressIndex], ...updates };
        }
        return newProgress;
      });
    };

    try {
      // Step 1: Presign
      updateProgress({ status: 'presigning' });
      const presignResult = await api.presignUpload({
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      });

      updateProgress({
        status: 'uploading',
        progress: 0,
        uploadId: presignResult.uploadId,
      });

      // Step 2: Upload to presigned URL
      const uploadResponse = await fetch(presignResult.presignedUrl, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }

      updateProgress({
        status: 'completing',
        progress: 100,
      });

      // Step 3: Complete upload
      await api.completeUpload(presignResult.uploadId);

      updateProgress({
        status: 'success',
        progress: 100,
      });

      // Reload uploads list
      setTimeout(() => {
        loadData();
      }, 500);
    } catch (error: any) {
      updateProgress({
        status: 'error',
        error: error.message || 'Upload failed',
      });
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  const config = getStoredConfig();
  if (!config) {
    return (
      <div>
        <h1>Uploads</h1>
        <div className="alert error">
          Please configure your connection on the Connect page first.
        </div>
      </div>
    );
  }

  if (!settings) {
    return <div>Failed to load settings</div>;
  }

  const maxSizeMB = Math.round(settings.maxFileSizeBytes / (1024 * 1024));

  return (
    <div>
      <h1>Uploads</h1>

      <div style={{ marginBottom: '2rem' }}>
        <h2>Current Settings</h2>
        <div style={{ background: 'white', padding: '1rem', borderRadius: '8px' }}>
          <p>
            <strong>Allowed Extensions:</strong>{' '}
            {settings.allowedExtensions.join(', ') || 'None'}
          </p>
          <p>
            <strong>Max File Size:</strong> {maxSizeMB} MB
          </p>
          <p>
            <strong>Allowed MIME Prefixes:</strong>{' '}
            {settings.allowedMimePrefixes.join(', ') || 'None'}
          </p>
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <h2>Upload Files</h2>
        <input
          type="file"
          multiple
          onChange={handleFileSelect}
          style={{ marginBottom: '1rem' }}
        />
        <small style={{ display: 'block', color: '#666', marginTop: '0.5rem' }}>
          Allowed: {settings.allowedExtensions.join(', ') || 'None'} | Max:{' '}
          {maxSizeMB} MB
        </small>

        {uploadProgress.length > 0 && (
          <div className="upload-progress">
            {uploadProgress.map((item, index) => (
              <div
                key={index}
                className={`upload-item ${
                  item.status === 'success'
                    ? 'success'
                    : item.status === 'error'
                    ? 'error'
                    : ''
                }`}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>{item.file.name}</span>
                  <span>
                    {item.status === 'pending' && 'Pending...'}
                    {item.status === 'presigning' && 'Getting upload URL...'}
                    {item.status === 'uploading' && `Uploading... ${item.progress}%`}
                    {item.status === 'completing' && 'Completing...'}
                    {item.status === 'success' && '✓ Success'}
                    {item.status === 'error' && `✗ Error: ${item.error}`}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2>Recent Uploads</h2>
        {uploads.length === 0 ? (
          <p>No uploads yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>File Name</th>
                <th>Size</th>
                <th>MIME Type</th>
                <th>Status</th>
                <th>Uploaded</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((upload) => (
                <tr key={upload.id}>
                  <td>{upload.originalFileName}</td>
                  <td>{formatFileSize(upload.sizeBytes)}</td>
                  <td>{upload.mimeType}</td>
                  <td>
                    <span
                      className={`status-badge ${upload.status.toLowerCase()}`}
                    >
                      {upload.status}
                    </span>
                  </td>
                  <td>{formatDate(upload.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

