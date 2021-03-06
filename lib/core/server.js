/* server.coffee*/


(function() {
  var Config, ContentPlugin, ContentTree, Stream, async, buildLookupMap, chokidar, colorCode, colors, enableDestroy, http, keyForValue, loadContent, mime, minimatch, normalizeUrl, pump, renderView, replaceInArray, run, runGenerator, setup, sleep, url, urlEqual, _ref;

  async = require('async');

  chokidar = require('chokidar');

  colors = require('colors');

  http = require('http');

  mime = require('mime');

  url = require('url');

  minimatch = require('minimatch');

  enableDestroy = require('server-destroy');

  Stream = require('stream').Stream;

  Config = require('./config').Config;

  _ref = require('./content'), ContentTree = _ref.ContentTree, ContentPlugin = _ref.ContentPlugin, loadContent = _ref.loadContent;

  pump = require('./utils').pump;

  renderView = require('./renderer').renderView;

  runGenerator = require('./generator').runGenerator;

  colorCode = function(code) {
    var s;
    s = code.toString();
    switch (Math.floor(code / 100)) {
      case 2:
        return s.green;
      case 4:
        return s.yellow;
      case 5:
        return s.red;
      default:
        return s;
    }
  };

  sleep = function(callback) {
    return setTimeout(callback, 50);
  };

  normalizeUrl = function(anUrl) {
    if (anUrl[anUrl.length - 1] === '/') {
      anUrl += 'index.html';
    }
    if (anUrl.match(/^([^.]*[^/])$/)) {
      anUrl += '/index.html';
    }
    anUrl = decodeURI(anUrl);
    return anUrl;
  };

  urlEqual = function(urlA, urlB) {
    return normalizeUrl(urlA) === normalizeUrl(urlB);
  };

  keyForValue = function(object, value) {
    var key;
    for (key in object) {
      if (object[key] === value) {
        return key;
      }
    }
    return null;
  };

  replaceInArray = function(array, oldItem, newItem) {
    var idx;
    idx = array.indexOf(oldItem);
    if (idx === -1) {
      return false;
    }
    array[idx] = newItem;
    return true;
  };

  buildLookupMap = function(contents) {
    var item, map, _i, _len, _ref1;
    map = {};
    _ref1 = ContentTree.flatten(contents);
    for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
      item = _ref1[_i];
      map[normalizeUrl(item.url)] = item;
    }
    return map;
  };

  setup = function(env) {
    /* Create a preview request handler.*/

    var block, changeHandler, contentHandler, contentWatcher, contents, isReady, loadContents, loadLocals, loadTemplates, loadViews, locals, logop, lookup, requestHandler, templateWatcher, templates, viewsWatcher;
    contents = null;
    templates = null;
    locals = null;
    lookup = {};
    block = {
      contentChange: false,
      contentsLoad: false,
      templatesLoad: false,
      viewsLoad: false,
      localsLoad: false
    };
    isReady = function() {
      /* Returns true if we have no running tasks*/

      var k, v;
      for (k in block) {
        v = block[k];
        if (v === true) {
          return false;
        }
      }
      return true;
    };
    logop = function(error) {
      if (error != null) {
        return env.logger.error(error.message, error);
      }
    };
    changeHandler = function(error) {
      /* Emits a change event if called without error*/

      if (error == null) {
        env.emit('change');
      }
      return logop(error);
    };
    loadContents = function(callback) {
      if (callback == null) {
        callback = logop;
      }
      block.contentsLoad = true;
      lookup = {};
      contents = null;
      return ContentTree.fromDirectory(env, env.contentsPath, function(error, result) {
        if (error == null) {
          contents = result;
          lookup = buildLookupMap(result);
        }
        block.contentsLoad = false;
        return callback(error);
      });
    };
    loadTemplates = function(callback) {
      if (callback == null) {
        callback = logop;
      }
      block.templatesLoad = true;
      templates = null;
      return env.getTemplates(function(error, result) {
        if (error == null) {
          templates = result;
        }
        block.templatesLoad = false;
        return callback(error);
      });
    };
    loadViews = function(callback) {
      if (callback == null) {
        callback = logop;
      }
      block.viewsLoad = true;
      return env.loadViews(function(error) {
        block.viewsLoad = false;
        return callback(error);
      });
    };
    loadLocals = function(callback) {
      if (callback == null) {
        callback = logop;
      }
      block.localsLoad = true;
      locals = null;
      return env.getLocals(function(error, result) {
        if (error == null) {
          locals = result;
        }
        block.localsLoad = false;
        return callback(error);
      });
    };
    contentWatcher = chokidar.watch(env.contentsPath, {
      ignored: function(path) {
        var pattern, _i, _len, _ref1;
        _ref1 = env.config.ignore;
        for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
          pattern = _ref1[_i];
          if (minimatch(env.relativeContentsPath(path), pattern)) {
            return true;
          }
        }
        return false;
      },
      ignoreInitial: true
    });
    contentWatcher.on('change', function(path) {
      var content, filepath, group, item, key, tree, _i, _len, _ref1;
      if ((contents == null) || block.contentsLoad) {
        return;
      }
      block.contentChange = true;
      content = null;
      _ref1 = ContentTree.flatten(contents);
      for (_i = 0, _len = _ref1.length; _i < _len; _i++) {
        item = _ref1[_i];
        if (item.__filename === path) {
          content = item;
          break;
        }
      }
      if (!content) {
        throw new Error("Got a change event for item not previously in tree: " + path);
      }
      filepath = {
        relative: env.relativeContentsPath(path),
        full: path
      };
      tree = content.parent;
      key = keyForValue(tree, content);
      group = tree._[content.__plugin.group];
      if (key == null) {
        throw new Error("Content " + content.filename + " not found in it's parent tree!");
      }
      return loadContent(env, filepath, function(error, newContent) {
        if (error != null) {
          contents = null;
          lookup = {};
          block.contentChange = false;
          return;
        }
        newContent.parent = tree;
        tree[key] = newContent;
        if (!replaceInArray(group, content, newContent)) {
          throw new Error("Content " + content.filename + " not found in it's plugin group!");
        }
        delete lookup[normalizeUrl(content.url)];
        lookup[normalizeUrl(newContent.url)] = newContent;
        block.contentChange = false;
        return env.emit('change', content.filename);
      });
    });
    contentWatcher.on('add', function() {
      if (!block.contentsLoad) {
        return loadContents(changeHandler);
      }
    });
    contentWatcher.on('unlink', function() {
      if (!block.contentsLoad) {
        return loadContents(changeHandler);
      }
    });
    templateWatcher = chokidar.watch(env.templatesPath, {
      ignoreInitial: true
    });
    templateWatcher.on('all', function(event, path) {
      if (!block.templatesLoad) {
        return loadTemplates(changeHandler);
      }
    });
    if (env.config.views != null) {
      viewsWatcher = chokidar.watch(env.resolvePath(env.config.views), {
        ignoreInitial: true
      });
      viewsWatcher.on('all', function(event, path) {
        if (!block.viewsLoad) {
          delete require.cache[path];
          return loadViews(changeHandler);
        }
      });
    }
    contentHandler = function(request, response, callback) {
      var uri;
      uri = normalizeUrl(url.parse(request.url).pathname);
      env.logger.verbose("contentHandler - " + uri);
      return async.waterfall([
        function(callback) {
          return async.mapSeries(env.generators, function(generator, callback) {
            return runGenerator(env, contents, generator, callback);
          }, callback);
        }, function(generated, callback) {
          var error, gentree, map, tree, _i, _len;
          if (generated.length > 0) {
            try {
              tree = new ContentTree('', env.getContentGroups());
              for (_i = 0, _len = generated.length; _i < _len; _i++) {
                gentree = generated[_i];
                ContentTree.merge(tree, gentree);
              }
              map = buildLookupMap(generated);
              ContentTree.merge(tree, contents);
            } catch (_error) {
              error = _error;
              return callback(error);
            }
            return callback(null, tree, map);
          } else {
            return callback(null, contents, {});
          }
        }, function(tree, generatorLookup, callback) {
          var content, pluginName;
          content = generatorLookup[uri] || lookup[uri];
          if (content != null) {
            pluginName = content.constructor.name;
            return renderView(env, content, locals, tree, templates, function(error, result) {
              var charset, contentType, mimeType;
              if (error) {
                return callback(error, 500, pluginName);
              } else if (result != null) {
                mimeType = mime.lookup(content.filename);
                charset = mime.charsets.lookup(mimeType);
                if (charset) {
                  contentType = "" + mimeType + "; charset=" + charset;
                } else {
                  contentType = mimeType;
                }
                if (result instanceof Stream) {
                  response.writeHead(200, {
                    'Content-Type': contentType
                  });
                  return pump(result, response, function(error) {
                    return callback(error, 200, pluginName);
                  });
                } else if (result instanceof Buffer) {
                  response.writeHead(200, {
                    'Content-Type': contentType
                  });
                  response.write(result);
                  response.end();
                  return callback(null, 200, pluginName);
                } else {
                  return callback(new Error("View for content '" + content.filename + "' returned invalid response. Expected Buffer or Stream."));
                }
              } else {
                return callback(null, 404, pluginName);
              }
            });
          } else {
            return callback();
          }
        }
      ], callback);
    };
    requestHandler = function(request, response) {
      var start, uri;
      start = Date.now();
      uri = url.parse(request.url).pathname;
      return async.waterfall([
        function(callback) {
          if (!block.contentsLoad && (contents == null)) {
            return loadContents(callback);
          } else {
            return callback();
          }
        }, function(callback) {
          if (!block.templatesLoad && (templates == null)) {
            return loadTemplates(callback);
          } else {
            return callback();
          }
        }, function(callback) {
          return async.until(isReady, sleep, callback);
        }, function(callback) {
          return contentHandler(request, response, callback);
        }
      ], function(error, responseCode, pluginName) {
        var delta, logstr;
        if ((error != null) || (responseCode == null)) {
          responseCode = error != null ? 500 : 404;
          response.writeHead(responseCode, {
            'Content-Type': 'text/plain'
          });
          response.end(error != null ? error.message : '404 Not Found\n');
        }
        delta = Date.now() - start;
        logstr = "" + (colorCode(responseCode)) + " " + uri.bold;
        if (pluginName != null) {
          logstr += (" " + pluginName).grey;
        }
        logstr += (" " + delta + "ms").grey;
        env.logger.info(logstr);
        if (error) {
          return env.logger.error(error.message, error);
        }
      });
    };
    loadContents();
    loadTemplates();
    loadViews();
    loadLocals();
    requestHandler.destroy = function() {
      contentWatcher.close();
      templateWatcher.close();
      return viewsWatcher != null ? viewsWatcher.close() : void 0;
    };
    return requestHandler;
  };

  run = function(env, callback) {
    var configWatcher, handler, restart, server, start, stop;
    server = null;
    handler = null;
    if (env.config._restartOnConfChange && (env.config.__filename != null)) {
      env.logger.verbose("watching config file " + env.config.__filename + " for changes");
      configWatcher = chokidar.watch(env.config.__filename);
      configWatcher.on('change', function() {
        var config, error;
        try {
          config = Config.fromFileSync(env.config.__filename);
        } catch (_error) {
          error = _error;
          env.logger.error("Error reloading config: " + error.message, error);
        }
        if (config != null) {
          env.setConfig(config);
          return restart(function(error) {
            if (error) {
              throw error;
            }
            env.logger.verbose('config file change detected, server reloaded');
            return env.emit('change');
          });
        }
      });
    }
    restart = function(callback) {
      env.logger.info('restarting server');
      return async.waterfall([stop, start], callback);
    };
    stop = function(callback) {
      if (server != null) {
        return server.destroy(function(error) {
          handler.destroy();
          env.reset();
          return callback(error);
        });
      } else {
        return callback();
      }
    };
    start = function(callback) {
      return async.series([
        function(callback) {
          return env.loadPlugins(callback);
        }, function(callback) {
          handler = setup(env);
          server = http.createServer(handler);
          enableDestroy(server);
          server.on('error', function(error) {
            if (typeof callback === "function") {
              callback(error);
            }
            return callback = null;
          });
          server.on('listening', function() {
            if (typeof callback === "function") {
              callback(null, server);
            }
            return callback = null;
          });
          return server.listen(env.config.port, env.config.hostname);
        }
      ], callback);
    };
    process.on('uncaughtException', function(error) {
      env.logger.error(error.message, error);
      return process.exit(1);
    });
    env.logger.verbose('starting preview server');
    return start(function(error, server) {
      var host, serverUrl;
      if (error == null) {
        host = env.config.hostname || 'localhost';
        serverUrl = ("http://" + host + ":" + env.config.port + env.config.baseUrl).bold;
        env.logger.info("server running on: " + serverUrl);
      }
      return callback(error, server);
    });
  };

  module.exports = {
    run: run,
    setup: setup
  };

}).call(this);
