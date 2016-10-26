var express = require("express");
var bodyParser = require("body-parser");
var session = require("express-session");
var databox_directory = require("./utils/databox_directory.js");
var request = require('request');

const Hs100Api = require('hs100-api');
const client = new Hs100Api.Client();

var DATABOX_STORE_BLOB_ENDPOINT = process.env.DATABOX_STORE_BLOB_ENDPOINT;


var SENSOR_TYPE_IDs = [];
var SENSOR_IDs = {};
var VENDOR_ID = null;
var DRIVER_ID = null;
var DATASTORE_ID = null;

//TODO find these on the network or make then configurable
var PLUGS = [{ip:'192.168.1.103',power_sid:null,powerState_sid:null,voltage_sid:null,current_sid:null,power_aid:null}]

var allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');
    res.header('Content-Type', 'application/json');
    next();
};


var app = express();
app.use(session({resave: false, saveUninitialized: false,  secret: 'databox'}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({extended: true}));
app.use(allowCrossDomain);

app.get("/status", function(req, res) {
    res.send("active");
});

app.post('/api/actuate', function(req, res, next) {
  		
      var actuator_id = req.body.actuator_id;
      var method = req.body.method;
      var data = req.body.data;
      
      var plug = PLUGS.find(function(itm){return itm.power_aid == actuator_id})

      if(plug == 'undefined') {
        console.log("plug not found!!!!");
        res.send("plug not found!!!!");
        return;
      }

      if(data == 'on' || data == true || data == 1 ) {
        p = client.getPlug({host: plug.ip});
        p.setPowerState(true);
      } else {
        p = client.getPlug({host: plug.ip});
        p.setPowerState(false);
      }

      res.send("OK");
});

var lastReading = {error:"no readings taken"}
app.get("/api/lastReading", function (req, res, next) {
  
    res.send(lastReading);
});

function updateSensors() {
  var data = [];
  //getConsumption() ==> {"get_realtime":{"current":0.04506,"voltage":241.11112,"power":5.022728,"total":0,"err_code":0}}
  for(plug of PLUGS) {
    p = client.getPlug({host: plug.ip});
    p.getConsumption()
    .then((consumption)=>{
      data.push(consumption);
      if(plug.power_sid != null) {
        save(plug.power_sid,consumption.get_realtime.power);
        save(plug.voltage_sid,consumption.get_realtime.voltage);
        save(plug.current_sid,consumption.get_realtime.current);
      }
    })
    .catch((err)=>{
      console.log("ERROR GETTING PLUG DATA:: ",err)
    });

    p.getPowerState()
    .then((powerstate)=>{
      data.push(powerstate);
      if(plug.powerState_sid != null) {
        save(plug.powerState_sid,powerstate);
      }
    })
    .catch((err)=>{
      console.log("ERROR GETTING PULG DATA:: ",err)
    });
  }
  lastReading = data;
}

setInterval(updateSensors, 5000);


app.listen(8080);


databox_directory.register_driver('TP-LINK','databox-driver-tplink-hs100', 'A Databox driver for the TP-LINK HS100 smart plug')
   .then((ids) => {
    console.log(ids);
    VENDOR_ID = ids['vendor_id'];
    DRIVER_ID = ids['driver_id'];
    
    console.log("VENDOR_ID", VENDOR_ID);
    console.log("DRIVER_ID", DRIVER_ID);

    return databox_directory.get_datastore_id('databox-store-blob');
  })
  .then ((datastore_id) => {
    DATASTORE_ID = datastore_id;
    console.log("DATASTORE_ID", DATASTORE_ID);
    proms = [
      databox_directory.register_sensor_type('power'),
      databox_directory.register_sensor_type('voltage'),
      databox_directory.register_sensor_type('current'),
      databox_directory.register_sensor_type('power-state'),
    ]
    return Promise.all(proms);
  })
  .then((sensorTypeIds)=>{
    console.log('sensorTypeIds::', sensorTypeIds);
    SENSOR_TYPE_IDs = sensorTypeIds;
    return Promise.resolve(PLUGS)
  }) 
  .then ((plugs) => {
    
    proms = [];

    for(plug of plugs) {
      proms.push(databox_directory.register_sensor(DRIVER_ID, SENSOR_TYPE_IDs[0].id, DATASTORE_ID, VENDOR_ID, plug.ip, 'Watts', 'w', 'power draw in Watts', ''));
      proms.push(databox_directory.register_sensor(DRIVER_ID, SENSOR_TYPE_IDs[1].id, DATASTORE_ID, VENDOR_ID, plug.ip, 'Volts', 'V', 'current voltage', ''));
      proms.push(databox_directory.register_sensor(DRIVER_ID, SENSOR_TYPE_IDs[2].id, DATASTORE_ID, VENDOR_ID, plug.ip, 'Amps', 'A', 'current in amps', ''));
      proms.push(databox_directory.register_sensor(DRIVER_ID, SENSOR_TYPE_IDs[3].id, DATASTORE_ID, VENDOR_ID, plug.ip, 'on or off', '', 'current power state of the plug', ''));
    }

    return Promise.all(proms);
  })
  .then((sensorIds) => {
    console.log("sensorIds::", sensorIds); 
    for(var i = 0; i < PLUGS.length; i++) {
      var j = i * 4;
      PLUGS[i].power_sid = sensorIds[j].id;
      PLUGS[i].voltage_sid = sensorIds[j+1].id;
      PLUGS[i].current_sid = sensorIds[j+2].id;
      PLUGS[i].powerState_sid = sensorIds[j+3].id;
    }
  })
  .then(()=>{
      var proms = []

      proms.push(
        new Promise((resolve, reject) => {
          databox_directory.register_actuator_type("set-plug-power", function(result) {
            on_id = result.id;
            for (var i in PLUGS) {
              var plug = PLUGS[i] 
              databox_directory.register_actuator( DRIVER_ID, on_id, DATASTORE_ID,VENDOR_ID, i,"Turn plug on and off", plug.ip, function (err,data) { 
                if(err) { 
                  console.log("[ERROR]", err, plug, DRIVER_ID, on_id,DATASTORE_ID,VENDOR_ID, i,"Turn plug on and off", plug.ip)
                  reject(err);
                  return;
                }
                PLUGS[i].power_aid = data.id;
                resolve();
              });
            }
          })
        })
      );

      return Promise.all(proms);
  })
  .then(() => {
    console.log("PLUGS", PLUGS);
  })
  .catch((err) => {
    console.log(err)
  });


module.exports = app;


function save(sid,data) {
      console.log("Saving data::", sid, data);
      if(VENDOR_ID != null) {
        var options = {
            uri: DATABOX_STORE_BLOB_ENDPOINT + '/data',
            method: 'POST',
            json: 
            {
              'sensor_id': sid, 
              'vendor_id': VENDOR_ID, 
              'data': data   
            }
        };
        request.post(options, (error, response, body) => { if(error) console.log(error, body);});
      }
    }