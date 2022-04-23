const url = require('url');

var plugin = {}

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = "signalk-chain-plugin"
  plugin.name = "Chain length and depth display for mobile phone"
  plugin.description = "Signal K webapp that displays chain length and depth. Intended for mobile phone near anchor."

  var unsubscribes = []

  var schema = {
    type: "object",
    title: plugin.name,
    description: plugin.description,
    properties: {
      chain: {
        type: "string",
        title: "Chain length",
        default: "winches.windlass.rode"
      },
      depth: {
        type: "string",
        title: "Depth",
        default: "environment.depth.belowkeel"
      }
    }
  } 

  plugin.schema = function() {
    return schema
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('starting plugin')
    app.debug("Options: " + JSON.stringify(options))
    let localSubscription = {
      context: '*', // Get data for all contexts
      subscribe: [
        {
          path: options.chain,
        },
        {
          path: options.depth,
        }
      ]
    };
    
    plugin.registerWithRouter = function(router) {
	  // Will appear here; plugins/signalk-chain-plugin/
	    app.debug("registerWithRouter")
	    router.get("/options", (req, res) => {
	      res.contentType("application/json")
	      res.send(JSON.stringify(options))
	    })
	  }
  }

  plugin.stop = function() {
    app.debug("Stopping")
    unsubscribes.forEach(f => f())
    // keyPaths.length = keyPaths.length - 1
    app.debug("Stopped")
  }

  return plugin;
};
module.exports.app = "app"
module.exports.options = "options"
