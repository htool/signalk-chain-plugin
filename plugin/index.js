const url = require('url');

var plugin = {}

module.exports = function(app, options) {
  "use strict"
  var plugin = {}
  plugin.id = "signalk-chain-plugin"
  plugin.name = "Chain length and depth display for mobile phone"
  plugin.description = "Signal K webapp that displays chain length and depth. Intended for mobile phone near anchor."

  var unsubscribes = []
  var currentOptions = {
    chain: "winches.windlass.rode",
    depth: "environment.depth.belowkeel"
  }

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

  function optionsPayload () {
    return {
      chain: (currentOptions && currentOptions.chain) || schema.properties.chain.default,
      depth: (currentOptions && currentOptions.depth) || schema.properties.depth.default
    }
  }

  function sendOptions (res) {
    res.contentType("application/json")
    res.send(JSON.stringify(optionsPayload()))
  }

  plugin.registerWithRouter = function(router) {
    app.debug("registerWithRouter")
    router.get("/options", function(req, res) {
      sendOptions(res)
    })
  }

  plugin.signalKApiRoutes = function(router) {
    router.get("/signalk-chain-plugin/options", function(req, res) {
      sendOptions(res)
    })
    return router
  }

  plugin.start = function(options, restartPlugin) {
    app.debug('starting plugin')
    app.debug("Options: " + JSON.stringify(options))
    currentOptions = options || currentOptions
    let localSubscription = {
      context: '*', // Get data for all contexts
      subscribe: [
        {
          path: currentOptions.chain,
        },
        {
          path: currentOptions.depth,
        }
      ]
    };
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
