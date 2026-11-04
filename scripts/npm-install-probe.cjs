/** Real installed-server boundary, including its native helper permission repair. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { createRequire } = require('node:module');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');

(async () => {
  const expectedRoot = fs.realpathSync(process.env.PI_EXPECTED_INSTALL_ROOT);
  const inside = p => {
    const relative = path.relative(expectedRoot, fs.realpathSync(p));
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  const home = process.env.PI_INSTALLED_PACKAGE || process.env.PATH.split(path.delimiter)
    .map(p => path.resolve(p, '..', 'pi-outpost'))
    .find(p => fs.existsSync(path.join(p, 'package.json')) && inside(p));
  assert.ok(home && inside(home), 'CLI must come from this fresh consumer installation');
  const req = createRequire(path.join(home, 'package.json'));
  assert.equal(req('./package.json').version, process.env.PI_EXPECTED_VERSION);
  const cli = path.join(home, 'dist/pi-outpost.mjs');
  assert.equal(execFileSync(process.execPath, [cli, '--version'], {encoding:'utf8'}).trim(), process.env.PI_EXPECTED_VERSION);
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const workspace = fs.mkdtempSync(path.join(process.cwd(), 'workspace-'));
  const config = path.join(workspace, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ cwd:workspace, agentDir:path.join(workspace,'.pi-agent'), openBrowser:false, noSkills:true, noPromptTemplates:true, webContext:false, sandbox:false, terminal:{enabled:true}, server:{host:'127.0.0.1',port} }));
  const env = {...process.env, PI_OFFLINE:'1', PI_CODING_AGENT_DIR:path.join(workspace,'.pi-agent'), ANTHROPIC_API_KEY:'sk-ant-not-a-real-key'};
  for (const key of Object.keys(env)) if (/API_KEY|AUTH_TOKEN|_TOKEN$/.test(key) && key !== 'ANTHROPIC_API_KEY') delete env[key];
  const server = spawn(process.execPath, [cli, '--config', config], {cwd:workspace, env, stdio:['ignore','pipe','pipe'], detached:true, windowsHide:true});
  let log = '';
  server.stdout.on('data', data => log += data);
  server.stderr.on('data', data => log += data);
  const closed = once(server, 'close');
  let socket;
  try {
    const deadline = Date.now() + 60000;
    for (;;) {
      if (server.exitCode !== null) throw new Error(`installed server exited: ${log}`);
      try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) break; } catch {}
      if (Date.now() > deadline) throw new Error(`installed server did not start: ${log}`);
      await new Promise(resolve => setTimeout(resolve,100));
    }
    await new Promise((resolve, reject) => {
      socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      let output = '';
      let sent = false;
      let exiting = false;
      const timer = setTimeout(() => reject(new Error(`installed terminal timed out: ${output}\n${log}`)), 20000);
      const fail = error => { clearTimeout(timer); reject(error); };
      socket.onerror = () => fail(new Error(`installed terminal socket failed: ${log}`));
      socket.onmessage = event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'hello') socket.send(JSON.stringify({type:'terminal_open',terminalId:'install-probe',cols:160,rows:24}));
          if (message.type === 'terminal_error') throw new Error(message.message);
          if (message.type === 'terminal_data') {
            output += message.data;
            if (!sent) { sent = true; socket.send(JSON.stringify({type:'terminal_input',terminalId:'install-probe',data:`node -e "console.log('PI_'+'NPM12_PTY_OK')"\r`})); }
            if (!exiting && output.includes('PI_NPM12_PTY_OK')) { exiting = true; socket.send(JSON.stringify({type:'terminal_input',terminalId:'install-probe',data:'exit\r'})); }
          }
          if (message.type === 'terminal_exit') {
            assert.ok(exiting, `terminal exited without command output: ${output}`);
            assert.equal(message.exitCode, 0);
            clearTimeout(timer);
            resolve();
          }
        } catch (error) { fail(error); }
      };
    });
    console.log('installed CLI + real application terminal passed');
  } finally {
    socket?.close();
    if (server.exitCode === null && server.signalCode === null) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/PID',String(server.pid),'/T','/F'], {stdio:'ignore',windowsHide:true});
        else process.kill(-server.pid, 'SIGKILL');
      } catch {}
    }
    await closed;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
