var loaded = false;

Module.persist = function() {
  if (!loaded) {
    return Promise.resolve();
  }
  return new Promise(function(resolve, reject) {
    FS.syncfs(false, function(err) {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

Module.preRun = (Module.preRun || []).concat(function() {
  addRunDependency('syncfs');
  FS.mkdir('/torjs');
  FS.mount(IDBFS, {}, '/torjs');
  FS.syncfs(true, function (err) {
    removeRunDependency('syncfs');
    if (err) throw err;
    loaded = true;
  });
});
