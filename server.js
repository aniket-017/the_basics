const fs = require("fs"); //we need this to read our keys. Part of node
const https = require("https"); //we need this for a secure express server. part of node
//express sets up the http server and serves our front end
const express = require("express");
const app = express();
//seve everything in public statically
app.use(express.static("public"));
const socketio = require("socket.io");
const mediasoup = require("mediasoup");

const config = require("./config/config");
const createWorkers = require("./createWorkers");
const createWebRtcTransportBothKinds = require("./createWebRtcTransportBothKinds.js");

const key = fs.readFileSync("./config/create-cert-key.pem");
const cert = fs.readFileSync("./config/create-cert.pem");
const options = { key, cert };
//use those keys with the https module to have https
const httpsServer = https.createServer(options, app);

const io = socketio(httpsServer, {
  cors: [`https://localhost:${config.port}`],
});

let workers = null;
//initMediaSoup gets mediasoup ready to do its thing
let router = null;

const initMediaSoup = async () => {
  workers = await createWorkers();
  // console.log(workers)
  router = await workers[0].createRouter({
    mediaCodecs: config.routerMediaCodecs,
  });
};

initMediaSoup(); //build our mediasoup server/sfu

// socketIo listeners
io.on("connect", (socket) => {
  let thisClientProducerTransport = null;
  let thisClientProducer = null;
  let thisClientConsumerTransport = null;
  let thisClientConsumer = null;
  // socket is the client that just connected
  // changed cb to ack, because cb is too generic
  // ack stand for acknowledge, and is a callback
  socket.on("getRtpCap", (ack) => {
    // ack is a callback to run, that will send the args
    // back to the client
    ack(router.rtpCapabilities);
  });

  socket.on("create-producer-transport", async (ack) => {
    // create a transport! A producer transport

    // thisClientProducerTransport = await router.createWebRtcTransport({
    //   enableUdp: true,
    //   enableTcp: true,
    //   preferUdp: true,
    //   listenInfos: [
    //     {
    //       protocol: "udp",
    //       ip: "0.0.0.0",
    //     },
    //     {
    //       protocol: "tcp",
    //       ip: "0.0.0.0",
    //     },
    //   ],
    // });
    // console.log("logging : ", thisClientProducerTransport);

    // const clientTransportParams = {
    //   id: thisClientProducerTransport.id,
    //   iceParameters: thisClientProducerTransport.iceParameters,
    //   iceCandidates: thisClientProducerTransport.iceCandidates,
    //   dtlsParameters: thisClientProducerTransport.dtlsParameters,
    // };
    // ack(clientTransportParams); //what we send back to the client

    const { transport, clientTransportParams } = await createWebRtcTransportBothKinds(router);
    thisClientProducerTransport = transport;
    ack(clientTransportParams); //what we send back to the client
  });

  socket.on("connect-transport", async (dtlsParameters, ack) => {
    //get the dtls info from the client, and finish the connection
    // on success, send success, on fail, send error
    try {
      await thisClientProducerTransport.connect(dtlsParameters);
      ack("success");
    } catch (error) {
      // something went wrong. Log it, and send back "err"
      console.log(error);
      ack("error");
    }
  });

  socket.on("start-producing", async ({ kind, rtpParameters }, ack) => {
    try {
      thisClientProducer = await thisClientProducerTransport.produce({ kind, rtpParameters });
      theProducer = thisClientProducer;
      thisClientProducer.on("transportclose", () => {
        console.log("Producer transport closed. Just fyi");
        thisClientProducer.close();
      });
      ack(thisClientProducer.id);
    } catch (error) {
      console.log(error);
      ack("error");
    }
  });

  socket.on("create-consumer-transport", async (ack) => {
    // create a transport! A producer transport
    const { transport, clientTransportParams } = await createWebRtcTransportBothKinds(router);
    thisClientConsumerTransport = transport;
    ack(clientTransportParams); //what we send back to the client
  });

  socket.on("connect-consumer-transport", async (dtlsParameters, ack) => {
    //get the dtls info from the client, and finish the connection
    // on success, send success, on fail, send error
    try {
      await thisClientConsumerTransport.connect(dtlsParameters);
      ack("success");
    } catch (error) {
      // something went wrong. Log it, and send back "err"
      console.log(error);
      ack("error");
    }
  });

  socket.on("consume-media", async ({ rtpCapabilities }, ack) => {
    console.log("i am here now !");

    if (!theProducer) {
      return ack("noProducer");
    }

    if (!router.canConsume({ producerId: theProducer.id, rtpCapabilities })) {
      return ack("cannotConsume");
    }

    console.log("i am here now, bro!");

    thisClientConsumer = await thisClientConsumerTransport.consume({
      producerId: theProducer.id,
      rtpCapabilities,
      paused: true, // Recommended
    });

    thisClientConsumer.on("transportclose", () => {
      console.log("Consumer transport closed.");
      thisClientConsumer.close();
    });

    const consumerParams = {
      producerId: theProducer.id,
      id: thisClientConsumer.id,
      kind: thisClientConsumer.kind,
      rtpParameters: thisClientConsumer.rtpParameters,
    };

    console.log("consumerParams: ", consumerParams);
    ack(consumerParams);


  });

  socket.on("unpauseConsumer", async (ack) => {
    await thisClientConsumer.resume();
  });
  socket.on("close-all", (ack) => {
    // client has requested to close ALL
    try {
      thisClientConsumerTransport?.close();
      thisClientProducerTransport?.close();
      ack("closed");
    } catch (error) {
      ack("closeError");
    }
  });
});

httpsServer.listen(config.port);
