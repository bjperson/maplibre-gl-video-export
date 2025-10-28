#!/bin/bash

# Script to setup symbolic links for demo
# Creates symlinks so demo always uses the latest build

set -e

DEMO_DIR="demo/assets/js"

echo "🔗 Setting up symbolic links for demo..."

cd "$DEMO_DIR"

# Remove old files/links if they exist
rm -rf maplibre-gl-video-export

# Create symlink to entire plugin directory (isolé)
echo "  → Linking maplibre-gl-video-export/ directory..."
ln -s ../../../dist/maplibre-gl-video-export .

cd - > /dev/null

echo "✅ Symbolic link created!"
echo ""
echo "📂 Structure:"
echo "   demo/assets/js/maplibre-gl-video-export/ → dist/maplibre-gl-video-export/"
echo "   ├── maplibre-gl-video-export.min.js"
echo "   └── vendor/"
echo "       ├── webm/ (included)"
echo "       └── mp4/ (CDN fallback)"
echo ""
echo "💡 Just run 'npm run build' and refresh your browser!"
