(() => {
  const isLocal = url => ['localhost', '127.0.0.1'].includes(url.hostname);
  function serverUrl(value) {
    let url;
    try { url = new URL(String(value).trim()); }
    catch { throw Error('Enter a server URL such as http://127.0.0.1:8790'); }
    if (url.username || url.password) throw Error('Enter the connection token in its own field, not the server URL');
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal(url))) {
      throw Error('Use HTTP for localhost or HTTPS for a cloud server');
    }
    if (!['/', '/api', '/api/', '/health', '/dashboard.html'].includes(url.pathname) || url.search || url.hash) {
      throw Error('Enter only the server address, without a page path, query, or fragment');
    }
    return url.origin;
  }
  async function connect(value, token, request = fetch) {
    const origin = serverUrl(value);
    token = String(token).trim();
    if (!token) throw Error('Enter the connection token from this project');
    const parsed = new URL(origin), candidates = [origin];
    // Earlier installations can still own 8787 while this checkout runs on 8790.
    // Discover only loopback servers, using an authenticated, read-only request.
    if (isLocal(parsed) && parsed.protocol === 'http:') {
      candidates.push(`http://127.0.0.1:${parsed.port || '80'}`);
      for (const port of ['8787', '8790']) candidates.push(`http://127.0.0.1:${port}`);
    }
    let unauthorized = false;
    for (const url of new Set(candidates)) {
      let response;
      try {
        response = await request(url + '/api/state', {
          headers: {Authorization: 'Bearer ' + token},
          signal: AbortSignal.timeout(5000), redirect: 'error'
        });
      } catch { continue; }
      if (response.status === 401) { unauthorized = true; continue; }
      if (!response.ok) continue;
      let state;
      try { state = await response.json(); } catch { continue; }
      if (!state?.config || !Array.isArray(state.jobs) || !Array.isArray(state.notifications)) continue;
      return {connection: {url, token}, state};
    }
    if (unauthorized) throw Error('The server answered, but the token did not match. Use the connection token from the intended server (npm run token for this project).');
    throw Error(`Cannot reach ${origin}. Check that the server is running and Chrome allows this extension to access the server address. Reload Practice Ex. after updating it.`);
  }
  let pairing;
  async function autoConnect(chromeApi = globalThis.chrome, request = fetch) {
    if (pairing) return pairing;
    pairing = (async () => {
      const saved = await chromeApi.storage.local.get(['connection', 'autoConnectDisabled']);
      if (saved.autoConnectDisabled) return null;
      // Explicit cloud connections remain under manual control.
      if (saved.connection && !isLocal(new URL(saved.connection.url))) return saved.connection;
      const file = await request(chromeApi.runtime.getURL('local-connection.json'), {cache:'no-store'});
      if (!file.ok) throw Error('Start Practice Ex. on this Mac to enable automatic connection');
      const bootstrap = await file.json();
      const url = serverUrl(bootstrap.url);
      if (!isLocal(new URL(url)) || !url.startsWith('http:') || !/^[a-f0-9]{64}$/.test(bootstrap.pairingKey)) throw Error('Invalid local pairing information');
      const response = await request(url + '/api/extension-pair', {
        method:'POST', headers:{'X-Practice-Pairing':bootstrap.pairingKey},
        signal:AbortSignal.timeout(5000), redirect:'error'
      });
      if (!response.ok) throw Error('Restart the local agent to refresh automatic pairing');
      const value = await response.json();
      if (!/^[a-f0-9]{64}$/.test(value.token)) throw Error('Invalid local connection response');
      const connection = {url, token:value.token};
      await chromeApi.storage.local.set({connection, autoConnectError:''});
      return connection;
    })().finally(() => {pairing = null;});
    return pairing;
  }
  globalThis.agentConnection = {serverUrl, connect, autoConnect};
})();
