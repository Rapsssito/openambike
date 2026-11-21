// The module the Vite plugin of scripts/licences.js builds.
declare module 'virtual:licences' {
    const licences: import('../scripts/licences.js').Licence[];
    export default licences;
}

/** The app's version, from android/app/version.properties. */
declare const __APP_VERSION__: string;
