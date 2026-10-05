/*
 * From https://www.redblobgames.com/maps/mapgen4/
 * Copyright 2018 Red Blob Games <redblobgames@gmail.com>
 * License: Apache v2.0 <http://www.apache.org/licenses/LICENSE-2.0.html>
 *
 * This module allows the user to paint constraints for the map generator
 */

/*
 * The painting interface uses a square array of elevations. As you
 * drag the mouse it will paint filled circles into the elevation map,
 * then send the elevation map to the generator to produce the output.
 */

import {createNoise2D} from 'simplex-noise';
import {makeRandFloat} from '@redblobgames/prng';

const CANVAS_SIZE = 128;

const currentStroke = {
    /* elevation before the current paint stroke began */
    previousElevation: new Float32Array(CANVAS_SIZE * CANVAS_SIZE),
    previousMoisture: new Float32Array(CANVAS_SIZE * CANVAS_SIZE),
    /* how long, in milliseconds, was spent painting */
    time: new Float32Array(CANVAS_SIZE * CANVAS_SIZE),
    /* maximum strength applied */
    strength: new Float32Array(CANVAS_SIZE * CANVAS_SIZE),
};


/* The elevation is -1.0 to 0.0 → water, 0.0 to +1.0 → land */
class Generator {
    seed = 0;
    island = 0;
    userHasPainted = false;
    elevation: Float32Array;
    moistureConstraints: Float32Array;

    constructor () {
        this.elevation = new Float32Array(CANVAS_SIZE * CANVAS_SIZE);
        this.moistureConstraints = new Float32Array(CANVAS_SIZE * CANVAS_SIZE);
    }

    setElevationParam(elevationParam) {
        if (   elevationParam.seed   !== this.seed
            || elevationParam.island !== this.island) {
            this.seed   = elevationParam.seed;
            this.island = elevationParam.island;
            this.generate();
        }
    }
    
    /** Use a noise function to determine the shape */
    generate() {
        const {elevation, island} = this;
        const noise2D = createNoise2D(makeRandFloat(this.seed));
        const persistence = 1/2;
        const amplitudes = Array.from({length: 5}, (_, octave) => Math.pow(persistence, octave));

        function fbm_noise(nx, ny) {
            let sum = 0, sumOfAmplitudes = 0;
            for (let octave = 0; octave < amplitudes.length; octave++) {
                let frequency = 1 << octave;
                sum += amplitudes[octave] * noise2D(nx * frequency, ny * frequency);
                sumOfAmplitudes += amplitudes[octave];
            }
            return sum / sumOfAmplitudes;
        }

        for (let y = 0; y < CANVAS_SIZE; y++) {
            for (let x = 0; x < CANVAS_SIZE; x++) {
                let p = y * CANVAS_SIZE + x;
                let nx = 2 * x/CANVAS_SIZE - 1,
                    ny = 2 * y/CANVAS_SIZE - 1;
                let distance = Math.max(Math.abs(nx), Math.abs(ny));
                let e = 0.5 * (fbm_noise(nx, ny) + island * (0.75 - 2 * distance * distance));
                if (e < -1.0) { e = -1.0; }
                if (e > +1.0) { e = +1.0; }
                elevation[p] = e;
                if (e > 0.0) {
                    let m = (0.5 * noise2D(nx + 30, ny + 50)
                             + 0.5 * noise2D(2*nx + 33, 2*ny + 55));
                    // TODO: make some of these into parameters
                    let mountain = Math.min(1.0, e * 5.0) * (1 - Math.abs(m) / 0.5);
                    if (mountain > 0.0) {
                        elevation[p] = Math.max(e, Math.min(e * 3, mountain));
                    }
                }
            }
        }

        this.moistureConstraints.fill(0);
        this.userHasPainted = false;
    }

    /**
     * Paint a circular region. x0, y0 should be 0 to 1
     */
    paintAt(tool: { elevation: number; forceDry?: boolean },
            x0: number, y0: number,
            size: { innerRadius: number; outerRadius: number; rate: number; },
            deltaTimeInMs: number) {
        let {elevation, moistureConstraints} = this;
        /* This has two effects: first time you click the mouse it has a
         * strong effect, and it also limits the amount in case you
         * pause */
        deltaTimeInMs = Math.min(100, deltaTimeInMs);

        let newElevation = tool.elevation;
        let {innerRadius, outerRadius, rate} = size;
        let xc = (x0 * CANVAS_SIZE) | 0, yc = (y0 * CANVAS_SIZE) | 0;
        let top = Math.ceil(Math.max(0, yc - outerRadius)),
            bottom = Math.floor(Math.min(CANVAS_SIZE-1, yc + outerRadius));
        for (let y = top; y <= bottom; y++) {
            let s = Math.sqrt(outerRadius * outerRadius - (y - yc) * (y - yc)) | 0;
            let left = Math.max(0, xc - s),
                right = Math.min(CANVAS_SIZE-1, xc + s);
            for (let x = left; x <= right; x++) {
                let p = y * CANVAS_SIZE + x;
                let distance = Math.sqrt((x - xc) * (x - xc) + (y - yc) * (y - yc));
                let strength = 1.0 - Math.min(1, Math.max(0, (distance - innerRadius) / (outerRadius - innerRadius)));
                let factor = rate/1000 * deltaTimeInMs;
                currentStroke.time[p] += strength * factor;
                if (strength > currentStroke.strength[p]) {
                    currentStroke.strength[p] = (1 - factor) * currentStroke.strength[p] + factor * strength;
                }
                let mix = currentStroke.strength[p] * Math.min(1, currentStroke.time[p]);
                elevation[p] = (1 - mix) * currentStroke.previousElevation[p] + mix * newElevation;
                moistureConstraints[p] = tool.forceDry
                    ? (1 - mix) * currentStroke.previousMoisture[p] + mix * 1.0
                    : (1 - mix) * currentStroke.previousMoisture[p];
            }
        }

        this.userHasPainted = true;
    }
}
let heightMap = new Generator();

let exported = {
    size: CANVAS_SIZE,
    onUpdate: () => {},
    screenToWorldCoords: coords => coords,
    constraints: heightMap.elevation,
    moistureConstraints: heightMap.moistureConstraints,
    brushSizeMultiplier: 1,
    brushRateMultiplier: 1,
    setElevationParam: elevationParam => heightMap.setElevationParam(elevationParam),
    userHasPainted: () => heightMap.userHasPainted,
};

document.getElementById('button-reset').addEventListener('click', () => {
    heightMap.generate();
    exported.onUpdate();
});


const SIZES = {
    // rate is effect per second
    tiny:   {key: '1', rate: 5, innerRadius: 1,   outerRadius: 2},
    small:  {key: '2', rate: 4, innerRadius: 1.5, outerRadius: 4},
    medium: {key: '3', rate: 3, innerRadius: 3,   outerRadius: 7},
    large:  {key: '4', rate: 2, innerRadius: 6,   outerRadius: 12},
};

const TOOLS = {
    ocean:    {elevation: -0.25, forceDry: false},
    shallow:  {elevation: -0.05, forceDry: false},
    valley:   {elevation: +0.05, forceDry: false},
    mountain: {elevation: +1.0,  forceDry: false},
    desert:   {elevation: +0.12, forceDry: true},
};

let currentTool = 'mountain';
let currentSize = 'small';

function displayCurrentTool() {
    const className = 'current-control';
    for (let c of document.querySelectorAll("."+className)) {
        c.classList.remove(className);
    }
    document.getElementById(currentTool).classList.add(className);
    document.getElementById(currentSize).classList.add(className);
}

const controls: [string, string, () => void][] = [
    ['1', "tiny",     () => { currentSize = 'tiny'; }],
    ['2', "small",    () => { currentSize = 'small'; }],
    ['3', "medium",   () => { currentSize = 'medium'; }],
    ['4', "large",    () => { currentSize = 'large'; }],
    ['q', "ocean",    () => { currentTool = 'ocean'; }],
    ['w', "shallow",  () => { currentTool = 'shallow'; }],
    ['e', "valley",   () => { currentTool = 'valley'; }],
    ['r', "mountain", () => { currentTool = 'mountain'; }],
    ['t', "desert",   () => { currentTool = 'desert'; }],
];

window.addEventListener('keydown', e => {
    for (let control of controls) {
        if (e.key === control[0]) { control[2](); displayCurrentTool(); }
    }
});

for (let control of controls) {
    document.getElementById(control[1]).addEventListener('click', () => { control[2](); displayCurrentTool(); } );
}
displayCurrentTool();


function setUpPaintEventHandling(el: HTMLElement, coordsTransform?: (coords: [number, number]) => [number, number]) {
    let dragging = false;
    let timestamp = 0;

    function start(event: PointerEvent) {
        if (event.button !== 0) return; // left button only
        el.setPointerCapture(event.pointerId);

        dragging = true;
        timestamp = Date.now();
        currentStroke.time.fill(0);
        currentStroke.strength.fill(0);
        currentStroke.previousElevation.set(heightMap.elevation);
        currentStroke.previousMoisture.set(heightMap.moistureConstraints);
        move(event);
    }

    function end(_event) {
        dragging = false;
    }

    function move(event: PointerEvent) {
        if (!dragging) return;

        const nowMs = Date.now();
        const bounds = el.getBoundingClientRect();
        let coords: [number, number] = [
            (event.x - bounds.left) / bounds.width,
            (event.y - bounds.top) / bounds.height,
        ];
        coords = (coordsTransform ?? exported.screenToWorldCoords)(coords);
        const sm = exported.brushSizeMultiplier;
        const rm = exported.brushRateMultiplier;
        let brushSize = {
            ...SIZES[currentSize],
            innerRadius: SIZES[currentSize].innerRadius * sm,
            outerRadius: SIZES[currentSize].outerRadius * sm,
            rate: SIZES[currentSize].rate * rm,
        };
        if (event.pointerType === 'pen' && event.pressure !== 0.5) {
            let radius = 2 * Math.sqrt(event.pressure);
            brushSize = {
                key: brushSize.key,
                innerRadius: Math.max(1, brushSize.innerRadius * radius),
                outerRadius: Math.max(2, brushSize.outerRadius * radius),
                rate: brushSize.rate,
            };
        }
        if (event.shiftKey) {
            brushSize = {...brushSize, rate: brushSize.rate/4};
        }
        heightMap.paintAt(TOOLS[currentTool], coords[0], coords[1],
                          brushSize, nowMs - timestamp);
        timestamp = nowMs;
        exported.onUpdate();
    }

    el.addEventListener('pointerdown', start);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('pointermove', move);
    el.addEventListener('touchstart', (e) => e.preventDefault()); // prevent scroll
}
setUpPaintEventHandling(document.getElementById('mapgen4'));

exported['addPaintCanvas'] = (el: HTMLElement, coordsTransform: (coords: [number, number]) => [number, number]) => {
    setUpPaintEventHandling(el, coordsTransform);
};

exported['getState'] = () => ({
    constraints: Array.from(heightMap.elevation),
    moistureConstraints: Array.from(heightMap.moistureConstraints),
    userHasPainted: heightMap.userHasPainted,
});

exported['loadState'] = (state: {constraints: number[], moistureConstraints: number[], userHasPainted: boolean, seed: number, island: number}) => {
    if (state.userHasPainted) {
        heightMap.elevation.set(state.constraints);
        heightMap.moistureConstraints.set(state.moistureConstraints);
        heightMap.userHasPainted = true;
        // Sync seed/island so setElevationParam won't overwrite the loaded constraints
        heightMap.seed = state.seed;
        heightMap.island = state.island;
    }
};

/* Set elevation constraints from an external Float32Array (e.g. batch image processing) */
exported['setConstraints'] = (elevationData: Float32Array) => {
    heightMap.elevation.set(elevationData);
    heightMap.moistureConstraints.fill(0);
    heightMap.userHasPainted = true;
};

export default exported;
