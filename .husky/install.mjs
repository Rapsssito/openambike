// Installs the git hooks of a development checkout. A production install (`npm ci --omit=dev`, as a release is built)
// has no husky, and installs nothing here without an error.
try {
    const { default: husky } = await import('husky');
    const failure = husky();
    if (failure) console.log(failure);
} catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}
