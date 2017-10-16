FS.mkdir('/persistent');
FS.mount(IDBFS, {}, '/persistent');

FS.syncfs(true, function (err) {
  console.log('hehe created persistence!', err);
  postMessage({ action: 'ready' });
});
