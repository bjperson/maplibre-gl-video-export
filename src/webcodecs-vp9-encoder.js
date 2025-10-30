/**
 * WebCodecs VP9 encoder wrapper using Mediabunny
 *
 * This encoder uses the native WebCodecs API for hardware-accelerated
 * VP9 encoding with high quality output. It provides a unified API
 * similar to webm-encoder-wrapper.js and mp4-h264 encoder.
 *
 * REQUIREMENTS:
 * - Modern browsers (WebCodecs API)
 * - Mediabunny library for WebM muxing (MPL-2.0 License)
 *   https://mediabunny.dev
 *
 * ADVANTAGES:
 * - Hardware accelerated encoding
 * - High quality output (better than webm-wasm realtime mode)
 * - Non-blocking (truly asynchronous)
 * - Direct canvas integration via VideoFrame
 */

// @ts-ignore - mediabunny is an external module
import { Output, WebMOutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, QUALITY_VERY_HIGH } from 'mediabunny';

export class WebCodecsVP9Encoder {
  constructor() {
    this.output = null;
    this.canvasSource = null;
    this.canvas = null;
    this.ctx = null;
    this.frameCount = 0;
    this.frameDuration = 0;
    this.currentTimestamp = 0;
    this.isFinalized = false;
    this.isStarted = false;
  }

  /**
     * Check if WebCodecs is supported in this browser
     * @returns {boolean}
     */
  static isSupported() {
    return typeof VideoEncoder !== 'undefined' &&
               typeof VideoFrame !== 'undefined';
  }

  /**
     * Create and initialize the encoder
     * @param {Object} options - Configuration object
     * @param {number} options.width - Video width in pixels
     * @param {number} options.height - Video height in pixels
     * @param {number} options.fps - Frames per second
     * @param {number} options.bitrate - Bitrate in kbps
     * @param {string} options.quality - Quality preset: 'medium', 'high', 'very-high'
     * @param {string} options.latencyMode - Latency mode: 'quality' or 'realtime'
     * @param {string} options.bitrateMode - Bitrate mode: 'variable' or 'constant'
     * @param {number} options.keyFrameInterval - Frames between keyframes
     * @param {string} options.contentHint - Content hint: '', 'motion', 'detail', 'text'
     * @returns {Promise<WebCodecsVP9Encoder>} This instance
     */
  async create(options) {
    const {
      width,
      height,
      fps,
      bitrate,
      quality = 'high',
      latencyMode = 'quality',
      bitrateMode = 'variable',
      keyFrameInterval = 120,
      contentHint = ''
    } = options;

    if (!WebCodecsVP9Encoder.isSupported()) {
      throw new Error('WebCodecs API not supported in this browser.');
    }

    console.log('[WebCodecs VP9] Initializing with:', {
      width,
      height,
      fps,
      bitrate: `${bitrate} kbps`,
      quality,
      latencyMode,
      bitrateMode,
      keyFrameInterval,
      contentHint: contentHint || 'auto',
      codec: 'VP9',
      api: 'WebCodecs + Mediabunny'
    });

    // Store frame duration in seconds
    this.frameDuration = 1 / fps;
    this.keyFrameInterval = keyFrameInterval;
    this.framesSinceKeyframe = 0;

    // Create a temporary canvas for encoding
    // We'll draw frames to this canvas and encode them
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d', {
      willReadFrequently: false,
      alpha: false
    });

    // Create Mediabunny output with WebM format
    this.output = new Output({
      format: new WebMOutputFormat(),
      target: new BufferTarget()
    });

    // Map quality preset to Mediabunny Quality constant
    let qualityConstant;
    if (quality === 'very-high') {
      qualityConstant = QUALITY_VERY_HIGH;
      console.log('[WebCodecs VP9] Quality: VERY_HIGH');
    } else if (quality === 'medium') {
      qualityConstant = QUALITY_HIGH; // Use HIGH even for medium (good enough)
      console.log('[WebCodecs VP9] Quality: MEDIUM (using HIGH)');
    } else {
      qualityConstant = QUALITY_HIGH; // default
      console.log('[WebCodecs VP9] Quality: HIGH');
    }

    // Build CanvasSource config with all options
    const canvasConfig = {
      codec: 'vp9',
      bitrate: qualityConstant,
      latencyMode,
      bitrateMode,
      keyFrameInterval
    };

    // Add content hint if specified
    if (contentHint) {
      canvasConfig.contentHint = contentHint;
    }

    console.log('[WebCodecs VP9] Canvas config:', canvasConfig);

    // Create canvas source with all options
    this.canvasSource = new CanvasSource(this.canvas, canvasConfig);

    // Add video track to output
    this.output.addVideoTrack(this.canvasSource);

    // Start the output (required before adding frames)
    await this.output.start();
    this.isStarted = true;

    console.log('[WebCodecs VP9] Initialization complete, ready to receive frames');
    return this;
  }

  /**
     * Add an RGBA frame to the video
     * @param {Uint8Array} rgbaBuffer - RGBA pixel data (width * height * 4 bytes)
     */
  async addFrame(rgbaBuffer) {
    if (this.isFinalized) {
      throw new Error('Cannot add frames after finalization');
    }

    if (!this.isStarted) {
      throw new Error('Encoder not started - call create() first');
    }

    if (!this.canvas || !this.ctx) {
      throw new Error('Canvas not initialized - call create() first');
    }

    this.frameCount++;

    if (this.frameCount % 30 === 0) {
      console.log(`[WebCodecs VP9] Encoding frame ${this.frameCount}`);
    }

    // Debug first frame
    if (this.frameCount === 1) {
      console.log(`[WebCodecs VP9] First frame - buffer size: ${rgbaBuffer.byteLength} bytes`);
    }

    // Convert RGBA buffer to ImageData
    const imageData = new ImageData(
      // @ts-ignore - rgbaBuffer.buffer can be SharedArrayBuffer which is compatible
      new Uint8ClampedArray(rgbaBuffer.buffer || rgbaBuffer),
      this.canvas.width,
      this.canvas.height
    );

    // Draw to canvas
    this.ctx.putImageData(imageData, 0, 0);

    // Add frame to CanvasSource with timestamp and duration (in seconds)
    // Mediabunny reads from the canvas automatically
    await this.canvasSource.add(this.currentTimestamp, this.frameDuration);

    // Increment timestamp for next frame
    this.currentTimestamp += this.frameDuration;
  }

  /**
     * Finalize encoding and get the WebM file
     * @returns {Promise<ArrayBuffer>} The complete WebM video data
     */
  async end() {
    if (this.isFinalized) {
      throw new Error('Encoder already finalized');
    }

    console.log(`[WebCodecs VP9] Finalizing encoding (${this.frameCount} total frames, ${this.currentTimestamp.toFixed(2)}s duration)`);
    this.isFinalized = true;

    try {
      // Finalize the output and get the video buffer
      await this.output.finalize();

      const videoBuffer = this.output.target.buffer;

      if (!videoBuffer) {
        throw new Error('No video buffer produced');
      }

      console.log(`[WebCodecs VP9] Successfully finalized video: ${videoBuffer.byteLength} bytes`);

      return videoBuffer;
    } catch (error) {
      console.error('[WebCodecs VP9] Finalization error:', error);
      throw new Error(`WebCodecs VP9 encoding failed: ${error.message || error}`);
    }
  }

  /**
     * Cleanup resources
     */
  destroy() {
    console.log('[WebCodecs VP9] Destroying encoder');

    if (this.canvasSource) {
      // Mediabunny handles cleanup internally
      this.canvasSource = null;
    }

    if (this.output) {
      this.output = null;
    }

    if (this.canvas) {
      this.canvas = null;
    }

    this.ctx = null;
    this.frameCount = 0;
    this.currentTimestamp = 0;
    this.frameDuration = 0;
    this.isFinalized = false;
    this.isStarted = false;
  }
}
