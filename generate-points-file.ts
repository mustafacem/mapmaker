/*
 * From https://www.redblobgames.com/maps/mapgen4b/
 * Copyright 2023 Red Blob Games <redblobgames@gmail.com>
 * @license Apache-2.0 <https://www.apache.org/licenses/LICENSE-2.0.html>
 *
 * Generate boundary + poisson disc points and save them to disk.
 */

import * as fs from 'fs';
import param from "./config.js";
import {choosePoints} from "./generate-points.ts";
import {toPointsFile} from "./serialize-points.ts";

function generate(mapWidth: number, mapHeight: number) {
    let p = choosePoints(
        param.mesh.seed, param.spacing, param.mountainSpacing, mapWidth, mapHeight);
    const filename = `build/points-${param.spacing}-${mapWidth}x${mapHeight}.data`;
    fs.writeFileSync(filename, toPointsFile(p));
    console.log(`Generated ${filename} (${p.points.length} points)`);
}

generate(1000, 1000);
generate(2000, 1000);
