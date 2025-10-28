#!/bin/bash

# Script to download optional MP4 encoder files
# Usage: ./scripts/download-encoder.sh [destination-path]
#
# By default, downloads to vendor/mp4/ (next to the plugin)
# Note: WebM encoders (VP8/VP9) are already included in the repo

VENDOR_PATH=${1:-"./vendor"}
MP4_PATH="$VENDOR_PATH/mp4"

echo "📦 Downloading MP4 encoder to $MP4_PATH"
echo ""
echo "💡 Note: WebM encoders (VP8/VP9) are already included in the repo"
echo ""

mkdir -p "$MP4_PATH"

echo "Downloading MP4 encoder files (mp4-h264)..."

cd "$MP4_PATH"

# File URLs
ENCODER_VERSION="1.0.7"
BASE_URL="https://unpkg.com/mp4-h264@${ENCODER_VERSION}/build"

# Download mp4-encoder.js
wget -q "${BASE_URL}/mp4-encoder.js"
echo "   ✅ mp4-encoder.js"

# Download mp4-encoder.wasm (no-SIMD)
wget -q "${BASE_URL}/mp4-encoder.wasm"
echo "   ✅ mp4-encoder.wasm"

# Download mp4-encoder-simd.wasm (with SIMD)
wget -q "${BASE_URL}/mp4-encoder.simd.wasm"
echo "   ✅ mp4-encoder.simd.wasm"

# Create index.js file for wasm-feature-detect
wget -q "https://unpkg.com/wasm-feature-detect?module" -O "./index.js"
echo "   ✅ index.js (SIMD detection)"

cd - > /dev/null

echo ""
echo "✅ MP4 encoder files downloaded successfully!"
echo ""
echo "📝 Usage:"
echo ""

if [ "$VENDOR_PATH" = "./vendor" ]; then
    echo "Files are in vendor/mp4/ - the plugin will auto-detect them!"
    echo "No configuration needed - just deploy the plugin with its vendor/ directory."
else
    echo "Files downloaded to: $MP4_PATH"
    echo ""
    echo "To use them, configure the plugin:"
    echo ""
    echo "   new VideoExportControl({"
    echo "     encoderPath: '/your/path/to/encoders/'"
    echo "   })"
fi

echo ""
echo "💡 Supported formats:"
echo "   • WebM VP9  - Best quality, royalty-free (native WebCodecs API)"
echo "   • WebM VP8  - Good quality, royalty-free (included in repo)"
echo "   • MP4 H.264 - Universal compatibility (just downloaded, ⚠️ patent concerns)"