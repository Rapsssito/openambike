// Rides as GPX 1.1, which other apps import (OsmAnd, Organic Maps, Komoot, Strava, Garmin Connect): one track per ride,
// a point per GPS fix, with the common extensions for speed (Garmin's TrackPointExtension) and the rider's power
// (`power`, as Strava reads it), and the motor's power in the app's own namespace.

/** @typedef {import('./ride.js').RideReader} RideReader */

/** How far, in milliseconds, a bike sample may be from a fix to be written with it. */
const SAMPLE_WINDOW_MS = 2000;

/**
 * @param {string} text
 * @returns {string}
 */
function escape(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/**
 * @param {{ name: string, reader: RideReader }[]} rides oldest first, as they are written
 * @param {{ creator: string }} options the app's name, as GPX asks
 * @returns {string}
 */
export function ridesToGpx(rides, { creator }) {
    const tracks = rides.map(({ name, reader }) => {
        const samples = reader.bikeSamples();
        let next = 0;
        const points = reader.route().map((fix) => {
            // The bike sample nearest in time, among those close enough.
            while (
                next + 1 < samples.length &&
                Math.abs(samples[next + 1].t - fix.t) <= Math.abs(samples[next].t - fix.t)
            ) {
                next++;
            }
            const sample =
                samples[next] && Math.abs(samples[next].t - fix.t) <= SAMPLE_WINDOW_MS ? samples[next] : null;
            const speedMps = sample ? sample.speedKmh / 3.6 : fix.speed;
            const extensions = [
                ...(speedMps !== null
                    ? [
                          `<gpxtpx:TrackPointExtension><gpxtpx:speed>${speedMps.toFixed(2)}</gpxtpx:speed></gpxtpx:TrackPointExtension>`,
                      ]
                    : []),
                ...(sample ? [`<power>${Math.round(sample.riderWatts)}</power>`] : []),
                ...(sample ? [`<openambike:motorPower>${Math.round(sample.motorWatts)}</openambike:motorPower>`] : []),
            ];
            return [
                `      <trkpt lat="${fix.lat.toFixed(7)}" lon="${fix.lon.toFixed(7)}">`,
                ...(fix.alt !== null ? [`        <ele>${fix.alt.toFixed(1)}</ele>`] : []),
                `        <time>${new Date(fix.t).toISOString()}</time>`,
                ...(extensions.length > 0 ? [`        <extensions>${extensions.join('')}</extensions>`] : []),
                '      </trkpt>',
            ].join('\n');
        });
        return [
            '  <trk>',
            `    <name>${escape(name)}</name>`,
            '    <type>cycling</type>',
            '    <trkseg>',
            ...points,
            '    </trkseg>',
            '  </trk>',
        ].join('\n');
    });
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        `<gpx version="1.1" creator="${escape(creator)}"`,
        '  xmlns="http://www.topografix.com/GPX/1/1"',
        '  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2"',
        '  xmlns:openambike="https://github.com/Rapsssito/openambike/gpx/1"',
        '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"',
        '  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">',
        ...tracks,
        '</gpx>',
        '',
    ].join('\n');
}
