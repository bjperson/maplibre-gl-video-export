/**
 * Wrapper for webm-wasm encoder that provides a unified API
 * similar to mp4-h264 encoder
 *
 * This wrapper encapsulates the complexity of the Web Worker-based
 * webm-wasm encoder and exposes a Promise-based API that matches
 * the synchronous mp4-h264 encoder API.
 *
 * IMPORTANT: Requires local webm-wasm files (vendor/webm/) to be deployed
 * alongside the plugin. Does NOT support CDN loading.
 */
export class WebmEncoderWrapper {
  constructor() {
    this.worker = null;
    this.resolveEnd = null;
    this.videoChunks = []; // Collect chunks (realtime) or single final video (non-realtime)
    this.frameCount = 0;
    this.realtimeMode = false; // Track encoding mode
  }

  /**
     * Create and initialize the encoder
     * @param {Object} options - Configuration object
     * @param {number} options.width - Video width in pixels
     * @param {number} options.height - Video height in pixels
     * @param {number} options.fps - Frames per second
     * @param {number} options.bitrate - Bitrate in kbps
     * @param {string} options.wasmUrl - URL to webm-wasm.wasm file (must be local/same-origin)
     * @param {string} options.workerUrl - URL to webm-worker.js file (must be local/same-origin)
     * @param {boolean} options.realtime - Enable realtime mode for faster encoding (default: false)
     * @returns {Promise<WebmEncoderWrapper>} This instance
     */
  async create(options) {
    const { width, height, fps, bitrate, wasmUrl, workerUrl, realtime = false } = options;

    // Store realtime mode for later
    this.realtimeMode = realtime;

    console.log('[WebM Encoder] Initializing with:', {
      width,
      height,
      fps,
      bitrate: `${bitrate} kbps`,
      realtime: realtime ? 'enabled (fast)' : 'disabled (high quality)',
      wasmUrl,
      workerUrl
    });

    // Validate worker URL before creating Worker (security: prevent code injection)
    let validatedWorkerUrl;
    try {
      const workerUrlObj = new URL(workerUrl, window.location.href);

      // Security check: Worker must be same-origin
      if (workerUrlObj.origin !== window.location.origin) {
        throw new Error(
          `Worker URL must be same-origin. Expected: ${window.location.origin}, Got: ${workerUrlObj.origin}`
        );
      }

      // Security check: Worker URL must end with expected filename
      if (!workerUrlObj.pathname.endsWith('webm-worker.js')) {
        throw new Error(
          `Invalid worker URL pattern. Expected path ending with 'webm-worker.js', Got: ${workerUrlObj.pathname}`
        );
      }

      validatedWorkerUrl = workerUrlObj.href;
    } catch (error) {
      throw new Error(
        `Worker URL validation failed: ${error.message}\n` +
                `Provided URL: ${workerUrl}`
      );
    }

    // Create worker from wrapper file (provides CommonJS shim)
    // The wrapper loads webm-worker.js with importScripts() after setting up exports/module
    const wrapperUrl = validatedWorkerUrl.replace('webm-worker.js', 'webm-worker-wrapper.js');
    try {
      console.log('[WebM Encoder] Creating worker from wrapper:', wrapperUrl);
      this.worker = new Worker(wrapperUrl);
    } catch (error) {
      throw new Error(
        'Failed to create WebM worker. Make sure vendor/webm/ files are deployed alongside the plugin.\n' +
                `Worker URL: ${wrapperUrl}\n` +
                `Error: ${error.message}`
      );
    }

    // Setup message handler
    this.worker.onmessage = (e) => {
      // Log what we receive (less verbose for chunks)
      if (e.data instanceof ArrayBuffer) {
        console.log(`[WebM Encoder] Chunk received: ${e.data.byteLength} bytes (total: ${this.videoChunks.length + 1})`);
      } else {
        console.log('[WebM Encoder] Worker message:',
          typeof e.data === 'object' ? JSON.stringify(e.data) : e.data);
      }

      if (e.data instanceof ArrayBuffer) {
        // Realtime mode: multiple chunks sent progressively
        // Non-realtime mode: single complete video sent at end
        this.videoChunks.push(e.data);
        console.log(`[WebM Encoder] Collected chunk ${this.videoChunks.length}: ${e.data.byteLength} bytes`);

        // In non-realtime mode, this single ArrayBuffer is the complete video
        // Resolve immediately if we're waiting in end()
        if (!this.realtimeMode && this.resolveEnd) {
          console.log('[WebM Encoder] Non-realtime mode: received final video');
          this.resolveEnd(e.data);
          this.resolveEnd = null;
        }
      } else if (e.data === 'ready' || e.data === 'READY') {
        console.log('[WebM Encoder] Worker ready');
        // Call ready callback if set (during initialization)
        if (this.resolveReady) {
          this.resolveReady();
          this.resolveReady = null;
        }
      } else if (e.data === null || e.data === undefined) {
        // Realtime mode: null signals end of encoding, concatenate all chunks
        console.log('[WebM Encoder] End signal (null) received - finalizing video');

        // If we're waiting in end(), resolve now
        if (this.resolveEnd) {
          console.log(`[WebM Encoder] Realtime mode: concatenating ${this.videoChunks.length} chunks...`);

          // Calculate total size
          const totalSize = this.videoChunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
          console.log(`[WebM Encoder] Total size: ${totalSize} bytes`);

          // Concatenate all chunks into final video
          const finalVideo = new Uint8Array(totalSize);
          let offset = 0;
          for (const chunk of this.videoChunks) {
            finalVideo.set(new Uint8Array(chunk), offset);
            offset += chunk.byteLength;
          }

          console.log(`[WebM Encoder] Video finalized: ${finalVideo.byteLength} bytes`);
          this.resolveEnd(finalVideo.buffer);
          this.resolveEnd = null;
        }
      } else if (typeof e.data === 'object' && e.data.error) {
        console.error('[WebM Encoder] Worker error:', e.data.error);
        if (this.resolveEnd) {
          this.resolveEnd(null);
          this.resolveEnd = null;
        }
      } else {
        console.log('[WebM Encoder] Unexpected worker message:', e.data);
      }
    };

    // Setup error handler
    this.worker.onerror = (error) => {
      console.error('[WebM Encoder] Worker error:', error);
      if (this.resolveEnd) {
        this.resolveEnd(null); // Signal error
        this.resolveEnd = null;
      }
    };

    // Send WASM path to worker
    console.log('[WebM Encoder] Sending WASM path to worker');
    this.worker.postMessage(wasmUrl);

    // Wait for worker to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.resolveReady = null;
        reject(new Error(
          'WebM worker initialization timeout. ' +
                    'Make sure vendor/webm/ files are correctly deployed.'
        ));
      }, 30000); // 30 seconds timeout

      // Set the callback that will be called when 'ready' message is received
      this.resolveReady = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    // Send encoder configuration (webm-wasm expects exactly: width, height, bitrate, realtime)
    console.log('[WebM Encoder] Configuring encoder');
    const config = {
      width,
      height,
      bitrate, // bitrate in kbps
      realtime // Realtime mode: false = high quality (slower), true = fast encoding
    };
    console.log('[WebM Encoder] Configuration:', config);
    this.worker.postMessage(config);

    // Wait a bit for the worker to process the configuration
    await new Promise(resolve => setTimeout(resolve, 100));

    console.log('[WebM Encoder] Initialization complete, ready to receive frames');
    return this;
  }

  /**
     * Add an RGBA frame to the video
     * @param {Uint8Array} rgbaBuffer - RGBA pixel data (width * height * 4 bytes)
     */
  addFrame(rgbaBuffer) {
    this.frameCount++;
    if (this.frameCount % 30 === 0) {
      console.log(`[WebM Encoder] Encoding frame ${this.frameCount}`);
    }

    // Debug first frame
    if (this.frameCount === 1) {
      console.log(`[WebM Encoder] First frame - buffer size: ${rgbaBuffer.byteLength} bytes`);
    }

    // IMPORTANT: webm-wasm expects ArrayBuffer, not Uint8Array
    // AND it needs to be transferred properly
    // Create a new ArrayBuffer and copy the data
    const buffer = new ArrayBuffer(rgbaBuffer.byteLength);
    const view = new Uint8Array(buffer);
    view.set(rgbaBuffer);

    // Send the ArrayBuffer WITHOUT transfer (copy instead)
    // This avoids potential issues with worker message queue blocking
    this.worker.postMessage(buffer);
  }

  /**
     * Finalize encoding and get the WebM file
     * @returns {Promise<ArrayBuffer>} The complete WebM video data
     */
  async end() {
    console.log(`[WebM Encoder] Finalizing encoding (${this.frameCount} total frames, ${this.videoChunks.length} chunks collected so far)`);

    // Signal end of stream to worker
    console.log('[WebM Encoder] Sending null to signal end of stream');
    try {
      this.worker.postMessage(null);
    } catch (error) {
      console.error('[WebM Encoder] Error sending null:', error);
      return Promise.reject(new Error('Failed to signal end of stream'));
    }

    // Wait for worker to send the final null signal
    return new Promise((resolve, reject) => {
      // Set timeout - give more time for large videos
      const timeout = setTimeout(() => {
        console.error('[WebM Encoder] Timeout waiting for end signal from worker');
        console.error(`[WebM Encoder] Chunks collected: ${this.videoChunks.length}`);
        reject(new Error('WebM encoding failed - timeout waiting for end signal'));
      }, 30000); // 30 seconds timeout for large videos

      // Set the resolver that will be called when null is received
      this.resolveEnd = (videoData) => {
        clearTimeout(timeout);
        if (videoData) {
          console.log(`[WebM Encoder] Successfully finalized video: ${videoData.byteLength} bytes`);
          resolve(videoData);
        } else {
          reject(new Error('WebM encoding failed - no video data'));
        }
      };
    });
  }

  /**
     * Cleanup and terminate the worker
     */
  destroy() {
    console.log('[WebM Encoder] Destroying encoder');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.videoChunks = [];
    this.resolveEnd = null;
    this.frameCount = 0;
  }
}
