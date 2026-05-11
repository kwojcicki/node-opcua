/**
 * env-paths-shim.js
 *
 * Shim for `env-paths`, which is called at module-load of
 * `node-opcua-certificate-manager` to resolve default PKI directories. In the
 * browser those directories are never read (we use
 * `InMemoryCertificateKeyPairProvider` + `InMemoryCertificateStore`), but the
 * function must still be callable at evaluation time.
 */

const envPathsShim = (name, _options) => ({
    data: `/env-paths/${name}/data`,
    config: `/env-paths/${name}/config`,
    cache: `/env-paths/${name}/cache`,
    log: `/env-paths/${name}/log`,
    temp: `/env-paths/${name}/temp`
});

export default envPathsShim;
