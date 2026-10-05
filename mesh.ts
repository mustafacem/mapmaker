/*
 * From https://www.redblobgames.com/maps/mapgen4/
 * Copyright 2018 Red Blob Games <redblobgames@gmail.com>
 * License: Apache v2.0 <http://www.apache.org/licenses/LICENSE-2.0.html>
 *
 * This module calculates:
 *   * mesh - Delaunay/Voronoi dual mesh
 */

import param from "./config.js";
import Delaunator from 'delaunator';
import {TriangleMesh, MeshInitializer} from "./dual-mesh/index.ts";
import {choosePoints} from "./generate-points.ts";
import {fromPointsFile} from "./serialize-points.ts";
import type {Mesh} from "./types.d.ts";

export function getSpacing(): number {
    const s = new URLSearchParams(location.search).get('spacing');
    return s ? parseFloat(s) : param.spacing;
}

export function getFboSize(): number {
    const r = new URLSearchParams(location.search).get('res');
    return r ? parseInt(r) : 4096;
}

export async function makeMesh() {
    const mapWidth = 1000, mapHeight = 1000;
    const spacing = getSpacing();
    const mountainSpacing = spacing * (param.mountainSpacing / param.spacing);

    let points: [number, number][];
    let numExteriorBoundaryPoints: number;
    let numInteriorBoundaryPoints: number;
    let numMountainPoints: number;

    if (spacing === param.spacing) {
        // Try pre-baked file first
        try {
            let pointsData = await (await fetch(`build/points-${param.spacing}-${mapWidth}x${mapHeight}.data`)).arrayBuffer();
            ({points, numExteriorBoundaryPoints, numInteriorBoundaryPoints, numMountainPoints} =
                fromPointsFile(new Uint16Array(pointsData)));
        } catch {
            ({points, numExteriorBoundaryPoints, numInteriorBoundaryPoints, numMountainPoints} =
                choosePoints(param.mesh.seed, spacing, mountainSpacing, mapWidth, mapHeight));
        }
    } else {
        ({points, numExteriorBoundaryPoints, numInteriorBoundaryPoints, numMountainPoints} =
            choosePoints(param.mesh.seed, spacing, mountainSpacing, mapWidth, mapHeight));
    }

    let meshInit: MeshInitializer = TriangleMesh.addGhostStructure({
        points,
        delaunator: Delaunator.from(points),
        numBoundaryPoints: numExteriorBoundaryPoints,
    });
    let mesh = new TriangleMesh(meshInit) as Mesh;
    console.log(`triangles = ${mesh.numTriangles} regions = ${mesh.numRegions}`);

    // Mark the triangles that are connected to a boundary region
    mesh.is_boundary_t = new Int8Array(mesh.numTriangles);
    for (let t = 0; t < mesh.numTriangles; t++) {
        mesh.is_boundary_t[t] = mesh.r_around_t(t).some(r => mesh.is_boundary_r(r)) ? 1 : 0;
    }

    mesh.length_s = new Float32Array(mesh.numSides);
    for (let s = 0; s < mesh.numSides; s++) {
        let r1 = mesh.r_begin_s(s),
            r2 = mesh.r_end_s(s);
        let dx = mesh.x_of_r(r1) - mesh.x_of_r(r2),
            dy = mesh.y_of_r(r1) - mesh.y_of_r(r2);
        mesh.length_s[s] = Math.sqrt(dx*dx + dy*dy);
    }

    let r_peaks = Array.from(
        {length: numMountainPoints},
        (_, index) => index + numExteriorBoundaryPoints + numInteriorBoundaryPoints);

    let t_peaks = [];
    for (let r of r_peaks) {
        t_peaks.push(mesh.t_inner_s(mesh._s_of_r[r]));
    }

    return {mesh, t_peaks, mapWidth, mapHeight};
}
