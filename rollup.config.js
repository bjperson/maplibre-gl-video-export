// @ts-nocheck
import terser from '@rollup/plugin-terser';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { readFileSync } from 'fs';

// Read version from package.json
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Plugin to inject version number
const injectVersion = {
    name: 'inject-version',
    transform(code) {
        return {
            code: code.replace(/__VERSION__/g, `'${pkg.version}'`),
            map: null // Minor transformation, let Rollup generate sourcemap normally
        };
    }
};

export default {
    input: 'src/index.js',
    plugins: [
        resolve({
            browser: true,
            preferBuiltins: false
        }),
        commonjs(),
        injectVersion
    ],
    onwarn(warning, warn) {
        // Ignore circular dependency warnings from mediabunny
        if (warning.code === 'CIRCULAR_DEPENDENCY' &&
            warning.message.includes('mediabunny')) {
            return;
        }
        // Show all other warnings
        warn(warning);
    },
    output: [
        {
            file: 'dist/maplibre-gl-video-export/maplibre-gl-video-export.js',
            format: 'iife',
            name: 'VideoExportControl',
            sourcemap: true,
            inlineDynamicImports: true,
            plugins: [
                {
                    name: 'attach-to-maplibregl',
                    renderChunk(code) {
                        // Return object with code and null map to fix sourcemap warning
                        return {
                            code: code + '\nif (typeof window !== "undefined" && window.maplibregl) { window.maplibregl.VideoExportControl = VideoExportControl; }',
                            map: null
                        };
                    }
                }
            ],
            globals: {
                'maplibre-gl': 'maplibregl'
            }
        },
        {
            file: 'dist/maplibre-gl-video-export/maplibre-gl-video-export.min.js',
            format: 'iife',
            name: 'VideoExportControl',
            sourcemap: true,
            inlineDynamicImports: true,
            plugins: [
                {
                    name: 'attach-to-maplibregl',
                    renderChunk(code) {
                        // Return object with code and null map to fix sourcemap warning
                        return {
                            code: code + '\nif (typeof window !== "undefined" && window.maplibregl) { window.maplibregl.VideoExportControl = VideoExportControl; }',
                            map: null
                        };
                    }
                },
                terser()
            ],
            globals: {
                'maplibre-gl': 'maplibregl'
            }
        }
    ],
    external: ['maplibre-gl']
};
