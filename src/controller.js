/**
 * Animation Controller
 *
 * Clean and modern animation control system using AbortController
 * Handles cancellation, state management, and position restoration
 */

export class AnimationController {
  constructor() {
    this.abortController = null;
    this.isRunning = false;
    this.initialPosition = null;
  }

  /**
     * Run an animation with cancellation support
     * @param {Object} map - MapLibre GL map instance
     * @param {Function} animation - Animation function to run
     * @param {Object} options - Options including updateStatus callback
     * @returns {Promise<{success?: boolean, cancelled?: boolean}>}
     */
  async run(map, animation, options = {}) {
    // If already running, cancel current animation
    if (this.isRunning) {
      this.cancel(map);
      return { cancelled: true };
    }

    // Initialize animation state
    this.isRunning = true;
    this.abortController = new AbortController();
    this.initialPosition = this._capturePosition(map);

    // Capture the signal reference to avoid context issues
    const signal = this.abortController.signal;

    try {
      // Run animation with abort signal
      await animation(map, {
        signal,
        updateStatus: options.updateStatus || (() => {}),
        checkAbort: () => {
          if (signal.aborted) {
            throw new DOMException('Animation aborted', 'AbortError');
          }
        }
      });

      return { success: true };
    } catch (error) {
      if (error.name === 'AbortError') {
        return { cancelled: true };
      }
      throw error;
    } finally {
      this.cleanup();
    }
  }

  /**
     * Cancel the current animation and restore initial position
     */
  cancel(map) {
    if (this.abortController) {
      this.abortController.abort();
    }

    // Restore initial position if map is provided
    if (map && this.initialPosition) {
      map.jumpTo(this.initialPosition);
    }

    this.cleanup();
  }

  /**
     * Stop the current animation without restoring position
     * (useful after recording completes)
     */
  stop() {
    if (this.abortController) {
      this.abortController.abort();
    }

    this.cleanup();
  }

  /**
     * Check if animation is currently running
     */
  get running() {
    return this.isRunning;
  }

  /**
     * Check if the animation has been aborted
     */
  get aborted() {
    return this.abortController?.signal.aborted ?? false;
  }

  /**
     * Clean up internal state
     */
  cleanup() {
    this.isRunning = false;
    this.abortController = null;
    this.initialPosition = null;
  }

  /**
     * Capture current map position
     */
  _capturePosition(map) {
    return {
      center: map.getCenter(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      pitch: map.getPitch()
    };
  }

  /**
     * Create a helper for animations to check abort status between steps
     * Returns a function that throws AbortError if cancelled
     */
  createAbortChecker() {
    // Capture the signal reference when the checker is created
    const signal = this.abortController ? this.abortController.signal : null;
    return () => {
      if (signal && signal.aborted) {
        throw new DOMException('Animation aborted', 'AbortError');
      }
    };
  }

  /**
     * Helper to wait for map movement with abort support
     * Automatically checks for abort after movement completes
     */
  async waitForMove(map, movePromise) {
    await movePromise;
    await map.once('moveend');

    // Check for abort after movement
    const signal = this.abortController ? this.abortController.signal : null;
    if (signal && signal.aborted) {
      throw new DOMException('Animation aborted', 'AbortError');
    }
  }
}
