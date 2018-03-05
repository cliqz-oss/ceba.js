// TODO: expose via Module.persist instead of arbitrary timeout
function persist() {
  FS.syncfs(false, function (err) {
    setTimeout(persist, 60 * 1000);
  });
}

Module.preRun = (Module.preRun || []).concat(function() {
  addRunDependency('syncfs');
  FS.mkdir('/torjs');
  FS.mount(IDBFS, {}, '/torjs');
  FS.syncfs(true, function (err) {
    if (err) throw err;
    removeRunDependency('syncfs');
    setTimeout(persist, 20 * 1000); // TODO: do after bootstrap...
  });
});
