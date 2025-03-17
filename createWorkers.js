const os = require("os"); //operating system module. part of node
const mediasoup = require("mediasoup");
const totalThreads = os.cpus().length; //maximum number of allowed workers
// console.log(totalThreads)
const config = require("./config/config.js");

const createWorkers = () =>
  new Promise(async (resolve, reject) => {
    let workers = [];
    //loop to create each worker
    for (let i = 0; i < totalThreads; i++) {
      const worker = await mediasoup.createWorker({
        //rtcMinPort and max are just arbitray ports for our traffic
        //useful for firewall or networking rules
        rtcMinPort: config.workerSettings.rtcMinPort,
        rtcMaxPort: config.workerSettings.rtcMaxPort,
        logLevel: config.workerSettings.logLevel,
        logTags: config.workerSettings.logTags,
      });
      worker.on("died", () => {
        //this should never happen, but if it does, do x...
        console.log("Worker has died");
        process.exit(1); //kill the node program
      });
      workers.push(worker);
    }

    resolve(workers);
  });

module.exports = createWorkers;
