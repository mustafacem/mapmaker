/*
 * From http://www.redblobgames.com/maps/mapgen4/
 * Copyright 2018 Red Blob Games <redblobgames@gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *      http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import param from "./config.js";
import {makeMesh, getSpacing, getFboSize} from "./mesh.ts";
import Painting from "./painting.ts";
import Renderer from "./render.ts";
import type {Mesh} from "./types.d.ts";


/**
 * Starts the UI, once the mesh has been loaded in.
 */
function main({mesh, t_peaks, mapWidth, mapHeight}: { mesh: Mesh; t_peaks: number[]; mapWidth: number; mapHeight: number; }) {
    const fboSize = getFboSize();
    const mapCanvas = document.getElementById('mapgen4') as HTMLCanvasElement;
    let render = new Renderer(mapCanvas, mesh, mapWidth, mapHeight, 0, fboSize);

    // each parameter is [initial value, low, high]
    // zoom/x/y depend on world dimensions so they're computed here
    const initialParams = {
        elevation: [
            ['seed', 187, 1, 1 << 30],
            ['island', 0.5, 0, 1],
            ['noisy_coastlines', 0.01, 0, 0.1],
            ['hill_height', 0.02, 0, 0.1],
            ['mountain_jagged', 0, 0, 1],
            ['mountain_sharpness', 9.8, 9.1, 12.5],
            ['mountain_folds', 0.05, 0.0, 0.5],
            ['ocean_depth', 1.40, 1, 3],
        ],
        biomes: [
            ['wind_angle_deg', 0, 0, 360],
            ['raininess', 0.9, 0, 2],
            ['rain_shadow', 0.5, 0.1, 2],
            ['evaporation', 0.5, 0, 1],
        ],
        rivers: [
            ['lg_min_flow', 2.7, -5, 5],
            ['lg_river_width', -2.4, -5, 5],
            ['flow', 0.2, 0, 1],
        ],
        render: [
            ['zoom', 200/mapHeight, 100/Math.max(mapWidth, mapHeight), 100/50],
            ['x', mapWidth/2, 0, mapWidth],
            ['y', mapHeight/2, 0, mapHeight],
            ['light_angle_deg', 80, 0, 360],
            ['slope', 2, 0, 5],
            ['flat', 2.5, 0, 5],
            ['ambient', 0.25, 0, 1],
            ['overhead', 30, 0, 60],
            ['tilt_deg', 0, 0, 90],
            ['rotate_deg', 0, -180, 180],
            ['mountain_height', 50, 0, 250],
            ['outline_depth', 1, 0, 2],
            ['outline_strength', 15, 0, 30],
            ['outline_threshold', 0, 0, 100],
            ['outline_coast', 0, 0, 1],
            ['outline_water', 13.0, 0, 20],
            ['biome_colors', 1, 0, 1],
        ],
    };

    /* set initial parameters */
    for (let phase of ['elevation', 'biomes', 'rivers', 'render']) {
        const container = document.createElement('div');
        const header = document.createElement('h3');
        header.appendChild(document.createTextNode(phase));
        container.appendChild(header);
        document.getElementById('sliders').appendChild(container);
        for (let [name, initialValue, min, max] of initialParams[phase]) {
            const step = name === 'seed'? 1 : 0.001;
            param[phase][name] = initialValue;

            let span = document.createElement('span');
            span.appendChild(document.createTextNode(name));

            let slider = document.createElement('input');
            slider.setAttribute('type', name === 'seed'? 'number' : 'range');
            slider.setAttribute('min', min);
            slider.setAttribute('max', max);
            slider.setAttribute('step', step.toString());
            slider.addEventListener('input', _event => {
                param[phase][name] = slider.valueAsNumber;
                requestAnimationFrame(() => {
                    if (phase == 'render') { redraw(); }
                    else { generate(); }
                });
            });

            /* improve slider behavior on iOS */
            function handleTouch(event: TouchEvent) {
                let rect = slider.getBoundingClientRect();
                let value = (event.changedTouches[0].clientX - rect.left) / rect.width;
                value = min + value * (max - min);
                value = Math.round(value / step) * step;
                if (value < min) { value = min; }
                if (value > max) { value = max; }
                slider.value = value.toString();
                slider.dispatchEvent(new Event('input'));
                event.preventDefault();
                event.stopPropagation();
            };
            slider.addEventListener('touchmove', handleTouch);
            slider.addEventListener('touchstart', handleTouch);

            let label = document.createElement('label');
            label.setAttribute('id', `slider-${name}`);
            label.appendChild(span);
            label.appendChild(slider);

            container.appendChild(label);
            slider.value = initialValue;
        }
    }

    function redraw() {
        render.updateView(param.render);
    }

    /* Render full map top-down and download as PNG */
    function download() {
        render.screenshotCallback = () => {
            let a = document.createElement('a');
            render.screenshotCanvas.toBlob(blob => {
                a.href = URL.createObjectURL(blob);
                a.setAttribute('download', `mapgen4-${param.elevation.seed}.png`);
                a.click();
            });
        };
        render.renderForDownload(param.render);
    }

    Painting.screenToWorldCoords = (coords) => {
        let out = render.screenToWorld(coords);
        return [out[0] / mapWidth, out[1] / mapHeight];
    };

    Painting.onUpdate = () => {
        generate();
    };

    /* Helper to keep slider UI in sync when zoom/pan changes via mouse */
    function syncSlider(name: string, value: number) {
        const label = document.getElementById(`slider-${name}`);
        if (label) (label.querySelector('input') as HTMLInputElement).value = String(value);
    }

    const aspect = mapWidth / mapHeight;

    /* Mouse wheel: zoom in/out centered on cursor position */
    mapCanvas.addEventListener('wheel', (e: WheelEvent) => {
        e.preventDefault();
        const bounds = mapCanvas.getBoundingClientRect();
        const sx = (e.clientX - bounds.left) / bounds.width;
        const sy = (e.clientY - bounds.top) / bounds.height;
        const [, , zoomMin, zoomMax] = initialParams.render.find(p => p[0] === 'zoom')!;
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const oldZoom = param.render.zoom;
        const newZoom = Math.max(zoomMin as number, Math.min(zoomMax as number, oldZoom * factor));
        const delta = 200 * (1 / oldZoom - 1 / newZoom);
        param.render.zoom = newZoom;
        param.render.x = Math.max(0, Math.min(mapWidth,  param.render.x + (sx - 0.5) * delta * aspect));
        param.render.y = Math.max(0, Math.min(mapHeight, param.render.y + (sy - 0.5) * delta));
        syncSlider('zoom', newZoom);
        syncSlider('x', param.render.x);
        syncSlider('y', param.render.y);
        redraw();
    }, { passive: false });

    /* Right-click drag: pan the map */
    let panAnchor: { sx: number; sy: number; cx: number; cy: number } | null = null;
    mapCanvas.addEventListener('pointerdown', (e: PointerEvent) => {
        if (e.button !== 2) return;
        e.preventDefault();
        mapCanvas.setPointerCapture(e.pointerId);
        const bounds = mapCanvas.getBoundingClientRect();
        panAnchor = {
            sx: (e.clientX - bounds.left) / bounds.width,
            sy: (e.clientY - bounds.top) / bounds.height,
            cx: param.render.x,
            cy: param.render.y,
        };
    });
    mapCanvas.addEventListener('pointermove', (e: PointerEvent) => {
        if (!panAnchor) return;
        const bounds = mapCanvas.getBoundingClientRect();
        const sx = (e.clientX - bounds.left) / bounds.width;
        const sy = (e.clientY - bounds.top) / bounds.height;
        const scale = 200 / param.render.zoom;
        param.render.x = Math.max(0, Math.min(mapWidth,  panAnchor.cx - (sx - panAnchor.sx) * scale * aspect));
        param.render.y = Math.max(0, Math.min(mapHeight, panAnchor.cy - (sy - panAnchor.sy) * scale));
        syncSlider('x', param.render.x);
        syncSlider('y', param.render.y);
        redraw();
    });
    mapCanvas.addEventListener('pointerup', (e: PointerEvent) => { if (e.button === 2) panAnchor = null; });
    mapCanvas.addEventListener('pointercancel', () => { panAnchor = null; });
    mapCanvas.addEventListener('contextmenu', e => e.preventDefault());

    const worker = new window.Worker("build/_worker.js");
    let working = false;
    let workRequested = false;
    let elapsedTimeHistory = [];
    let batchCallback: (() => void) | null = null;

    worker.addEventListener('messageerror', event => {
        console.log("WORKER ERROR", event);
    });

    worker.addEventListener('message', event => {
        working = false;
        let {elapsed, numRiverTriangles, quad_elements_buffer, a_quad_em_buffer, a_river_xyww_buffer} = event.data;
        elapsedTimeHistory.push(elapsed | 0);
        if (elapsedTimeHistory.length > 10) { elapsedTimeHistory.splice(0, 1); }
        const timingDiv = document.getElementById('timing');
        if (timingDiv) { timingDiv.innerText = `${elapsedTimeHistory.join(' ')} milliseconds`; }
        render.quad_elements = new Int32Array(quad_elements_buffer);
        render.a_quad_em = new Float32Array(a_quad_em_buffer);
        render.a_river_xyww = new Float32Array(a_river_xyww_buffer);
        render.numRiverTriangles = numRiverTriangles;
        render.updateMap();
        redraw();
        if (batchCallback) {
            const cb = batchCallback;
            batchCallback = null;
            cb();
        } else if (workRequested) {
            requestAnimationFrame(() => {
                workRequested = false;
                generate();
            });
        }
    });

    function updateUI() {
        let userHasPainted = Painting.userHasPainted();
        (document.querySelector("#slider-seed input") as HTMLInputElement).disabled = userHasPainted;
        (document.querySelector("#slider-island input") as HTMLInputElement).disabled = userHasPainted;
        (document.querySelector("#button-reset") as HTMLInputElement).disabled = !userHasPainted;
    }

    function generate() {
        if (!working) {
            working = true;
            Painting.setElevationParam(param.elevation);
            updateUI();
            param.mapWidth = mapWidth;
            param.mapHeight = mapHeight;
            worker.postMessage({
                param,
                constraints: {
                    size: Painting.size,
                    constraints: Painting.constraints,
                    moistureConstraints: Painting.moistureConstraints,
                },
                quad_elements_buffer: render.quad_elements.buffer,
                a_quad_em_buffer: render.a_quad_em.buffer,
                a_river_xyww_buffer: render.a_river_xyww.buffer,
            }, [
                render.quad_elements.buffer,
                render.a_quad_em.buffer,
                render.a_river_xyww.buffer,
            ]
            );
        } else {
            workRequested = true;
        }
    }

    /* ------------------------------------------------------------------ */
    /* Save / Load project                                                  */
    /* ------------------------------------------------------------------ */

    function buildProjectData() {
        const paramsSnapshot: any = {};
        for (let phase of ['elevation', 'biomes', 'rivers', 'render']) {
            paramsSnapshot[phase] = {...param[phase]};
        }
        return {
            version: 1,
            spacing: getSpacing(),
            fboSize: fboSize,
            params: paramsSnapshot,
            painting: Painting['getState'](),
        };
    }

    function applyProjectData(data: any) {
        for (let phase of ['elevation', 'biomes', 'rivers', 'render']) {
            for (let [name] of initialParams[phase]) {
                if (data.params?.[phase]?.[name] !== undefined) {
                    param[phase][name] = data.params[phase][name];
                    const input = document.querySelector(`#slider-${name} input`) as HTMLInputElement;
                    if (input) input.value = String(data.params[phase][name]);
                }
            }
        }
        if (data.painting) {
            Painting['loadState']({
                ...data.painting,
                seed: data.params?.elevation?.seed ?? param.elevation.seed,
                island: data.params?.elevation?.island ?? param.elevation.island,
            });
        }
        updateUI();
        redraw();
        generate();
    }

    /* Save to JSON file */
    const saveBtn = document.getElementById('button-save');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            const data = buildProjectData();
            const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `mapgen4-project-${param.elevation.seed}.json`;
            a.click();
        });
    }

    /* Load from JSON file */
    const loadInput = document.getElementById('input-load') as HTMLInputElement;
    if (loadInput) {
        loadInput.addEventListener('change', () => {
            const file = loadInput.files?.[0];
            if (!file) return;
            loadInput.value = '';
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const data = JSON.parse(reader.result as string);
                    const currentSpacing = getSpacing();
                    const currentFboSize = fboSize;
                    const needReload =
                        (data.spacing !== undefined && data.spacing !== currentSpacing) ||
                        (data.fboSize !== undefined && data.fboSize !== currentFboSize);
                    if (needReload) {
                        localStorage.setItem('mapgen4-pending-load', JSON.stringify(data));
                        const url = new URL(location.href);
                        url.searchParams.set('spacing', String(data.spacing ?? currentSpacing));
                        url.searchParams.set('res',     String(data.fboSize ?? currentFboSize));
                        location.href = url.toString();
                    } else {
                        applyProjectData(data);
                    }
                } catch (e) {
                    alert('Failed to load project file: ' + e);
                }
            };
            reader.readAsText(file);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Resolution and cell-density controls                                 */
    /* ------------------------------------------------------------------ */

    const resSelect = document.getElementById('select-resolution') as HTMLSelectElement;
    if (resSelect) {
        resSelect.value = String(fboSize);
        resSelect.addEventListener('change', () => {
            const newRes = resSelect.value;
            localStorage.setItem('mapgen4-pending-load', JSON.stringify(buildProjectData()));
            const url = new URL(location.href);
            url.searchParams.set('res', newRes);
            location.href = url.toString();
        });
    }

    const spacingSelect = document.getElementById('select-spacing') as HTMLSelectElement;
    if (spacingSelect) {
        spacingSelect.value = String(getSpacing());
        spacingSelect.addEventListener('change', () => {
            const newSpacing = spacingSelect.value;
            localStorage.setItem('mapgen4-pending-load', JSON.stringify(buildProjectData()));
            const url = new URL(location.href);
            url.searchParams.set('spacing', newSpacing);
            location.href = url.toString();
        });
    }

    /* ------------------------------------------------------------------ */
    /* Brush controls                                                       */
    /* ------------------------------------------------------------------ */

    const brushSizeSlider = document.getElementById('brush-size') as HTMLInputElement;
    if (brushSizeSlider) brushSizeSlider.addEventListener('input', () => {
        Painting.brushSizeMultiplier = brushSizeSlider.valueAsNumber;
    });
    const brushRateSlider = document.getElementById('brush-rate') as HTMLInputElement;
    if (brushRateSlider) brushRateSlider.addEventListener('input', () => {
        Painting.brushRateMultiplier = brushRateSlider.valueAsNumber;
    });

    /* ------------------------------------------------------------------ */
    /* Image overlay                                                        */
    /* ------------------------------------------------------------------ */

    const overlayImg     = document.getElementById('overlay-img') as HTMLImageElement;
    const overlayInput   = document.getElementById('input-overlay') as HTMLInputElement;
    const overlayOpacity = document.getElementById('overlay-opacity') as HTMLInputElement;
    const overlayRemove  = document.getElementById('button-overlay-remove');

    if (overlayInput && overlayImg) {
        overlayInput.addEventListener('change', () => {
            const file = overlayInput.files?.[0];
            if (!file) return;
            overlayInput.value = '';
            if (overlayImg.src) URL.revokeObjectURL(overlayImg.src);
            overlayImg.src = URL.createObjectURL(file);
            overlayImg.style.display = 'block';
        });
    }
    if (overlayOpacity && overlayImg) {
        overlayOpacity.addEventListener('input', () => {
            overlayImg.style.opacity = overlayOpacity.value;
        });
    }
    if (overlayRemove && overlayImg) {
        overlayRemove.addEventListener('click', () => {
            if (overlayImg.src) URL.revokeObjectURL(overlayImg.src);
            overlayImg.src = '';
            overlayImg.style.display = 'none';
        });
    }

    /* ------------------------------------------------------------------ */
    /* Batch tile generation from image                                    */
    /* ------------------------------------------------------------------ */

    let batchImageFile: File | null = null;

    function processBatch(cols: number, rows: number) {
        if (!batchImageFile) return;
        const statusEl = document.getElementById('batch-status');
        const runBtn   = document.getElementById('button-batch-run') as HTMLButtonElement;
        if (runBtn) runBtn.disabled = true;

        const img = new Image();
        const imgUrl = URL.createObjectURL(batchImageFile);
        img.onerror = () => {
            URL.revokeObjectURL(imgUrl);
            if (statusEl) statusEl.textContent = 'Error loading image.';
            if (runBtn) runBtn.disabled = false;
        };
        img.onload = () => {
            const SAMPLE = 128; // painting constraint grid size
            const tileCanvas = document.createElement('canvas');
            tileCanvas.width = SAMPLE; tileCanvas.height = SAMPLE;
            const tileCtx = tileCanvas.getContext('2d')!;
            const tileW = img.width / cols;
            const tileH = img.height / rows;

            // Stitching canvas: one cell per tile at FBO resolution
            const fboW = render.fbo_w;
            const fboH = render.fbo_h;
            const stitchCanvas = document.createElement('canvas');
            stitchCanvas.width  = cols * fboW;
            stitchCanvas.height = rows * fboH;
            const stitchCtx = stitchCanvas.getContext('2d')!;

            const total = cols * rows;
            let idx = 0;

            function nextTile() {
                if (idx >= total) {
                    URL.revokeObjectURL(imgUrl);
                    stitchCanvas.toBlob(blob => {
                        const a = document.createElement('a');
                        a.href = URL.createObjectURL(blob);
                        a.download = `map-tiles-${cols}x${rows}.png`;
                        a.click();
                    });
                    if (statusEl) statusEl.textContent = `Done — ${total} tiles stitched.`;
                    if (runBtn) runBtn.disabled = false;
                    return;
                }

                const row = Math.floor(idx / cols);
                const col = idx % cols;
                if (statusEl) statusEl.textContent = `Tile ${idx + 1} / ${total}…`;

                // Sample tile → elevation array
                tileCtx.clearRect(0, 0, SAMPLE, SAMPLE);
                tileCtx.drawImage(img, col * tileW, row * tileH, tileW, tileH, 0, 0, SAMPLE, SAMPLE);
                const pixels = tileCtx.getImageData(0, 0, SAMPLE, SAMPLE).data;
                const elevation = new Float32Array(SAMPLE * SAMPLE);
                for (let i = 0; i < SAMPLE * SAMPLE; i++) {
                    const r = pixels[i*4] / 255, g = pixels[i*4+1] / 255, b = pixels[i*4+2] / 255;
                    // perceptual brightness → elevation: 0=deep ocean, 0.5=sea level, 1=mountain
                    elevation[i] = (0.299*r + 0.587*g + 0.114*b) * 2 - 1;
                }
                Painting['setConstraints'](elevation);

                // After worker responds, capture screenshot and stitch
                const captureRow = row, captureCol = col;
                batchCallback = () => {
                    render.screenshotCallback = () => {
                        stitchCtx.drawImage(render.screenshotCanvas, captureCol * fboW, captureRow * fboH);
                        idx++;
                        nextTile();
                    };
                    render.renderForDownload(param.render);
                };

                // Kick off generation for this tile
                working = false;
                workRequested = false;
                generate();
            }

            nextTile();
        };
        img.src = imgUrl;
    }

    const batchInput  = document.getElementById('input-batch') as HTMLInputElement;
    const batchRunBtn = document.getElementById('button-batch-run') as HTMLButtonElement;

    if (batchInput) {
        batchInput.addEventListener('change', () => {
            const file = batchInput.files?.[0];
            if (!file) return;
            batchInput.value = '';
            batchImageFile = file;
            const statusEl = document.getElementById('batch-status');
            if (statusEl) statusEl.textContent = `Image: ${file.name}`;
            if (batchRunBtn) batchRunBtn.disabled = false;
        });
    }
    if (batchRunBtn) {
        batchRunBtn.disabled = true;
        batchRunBtn.addEventListener('click', () => {
            const cols = parseInt((document.getElementById('batch-cols') as HTMLInputElement).value) || 2;
            const rows = parseInt((document.getElementById('batch-rows') as HTMLInputElement).value) || 2;
            processBatch(cols, rows);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Initial generate + optional auto-restore from localStorage          */
    /* ------------------------------------------------------------------ */

    param.mapWidth = mapWidth;
    param.mapHeight = mapHeight;
    worker.postMessage({mesh, t_peaks, param});

    const pendingLoad = localStorage.getItem('mapgen4-pending-load');
    if (pendingLoad) {
        localStorage.removeItem('mapgen4-pending-load');
        try {
            const data = JSON.parse(pendingLoad);
            applyProjectData(data);
        } catch {
            generate();
        }
    } else {
        generate();
    }

    const downloadButton = document.getElementById('button-download');
    if (downloadButton) downloadButton.addEventListener('click', download);
}

makeMesh().then(main);
