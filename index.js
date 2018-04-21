const {registerFont, createCanvas} = require("canvas");
const mqtt = require("mqtt");

const config = require("./config.json");

if (!config || !config.mqttBroker || !config.mqttTopicTraffic || !config.mqttTopicWeather) {
	throw new Error("Missing configuration. Check config.json and config.json.example");
}

const RED = "rgba(255,0,0,1)";
const BLACK = "rgba(0,0,0,1)";
const WHITE = "rgba(255,255,255,1)";

const displayDimX = 212;
const displayDimY = 104;

let displayInitPromise;
let inkyphat;
if (!config.simulation) {
	inkyphat = require("inkyphat").getInstance();
	displayInitPromise = inkyphat.init();
} else {
	inkyphat = {
		pixels: [],
		setPixel: function(x, y, color) {
			this.pixels.push({
				x,
				y,
				fillStyle: color === 0 ? WHITE : (color === 1 ? BLACK : RED)
			});
		},
		redraw: async function() {},
		WHITE: 0,
		BLACK: 1,
		RED: 2
	};
	displayInitPromise = Promise.resolve();
}

displayInitPromise.then(loadFont).then(() => {
	const mqttClient = mqtt.connect(config.mqttBroker);
	mqttClient.on("connect", function() {
		mqttClient.subscribe(config.mqttTopicTraffic);
		mqttClient.subscribe(config.mqttTopicWeather);
	});

	let busy = false;
	let lastTrafficData;
	let lastWeatherData;

	mqttClient.on("message", function(topic, message) {
		if (busy) {
			console.log("Busy! Ignoring new message...");
			return;
		}
		switch (topic) {
		case config.mqttTopicTraffic:
			lastTrafficData = JSON.parse(message);

			if (!lastWeatherData) {
				console.log("Got traffic data. Waiting for new weather data...");
				break;
			}
			busy = true;
			render({traffic: lastTrafficData, weather: lastWeatherData}).then(() => {
				busy = false;

				// Resetting data so next rendering will only happen if both got updated
				lastTrafficData = null;
				lastWeatherData = null;
			}, (err) => {
				console.log("Error");
				console.log(err);
				busy = false;
			});
			break;
		case config.mqttTopicWeather:
			lastWeatherData = JSON.parse(message);

			if (!lastTrafficData) {
				console.log("Got weather data. Waiting for new traffic data...");
				break;
			}
			busy = true;
			render({traffic: lastTrafficData, weather: lastWeatherData}).then(() => {
				busy = false;

				// Resetting data so next rendering will only happen if both got updated
				lastTrafficData = null;
				lastWeatherData = null;
			}, (err) => {
				console.log("Error");
				console.log(err);
				busy = false;
			});
			break;
		default:
			console.log(`Received message for unknown topic '${topic}'`);
			break;
		}
	});
});

async function render({traffic, weather}) {
	console.log(traffic);
	console.log(weather);

	/*
		Render into canvas
	*/
	const canvas = createCanvas(displayDimX, displayDimY);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = WHITE;
	ctx.fillRect(0, 0, displayDimX, displayDimY);

	// Traffic
	ctx.font = "10px 'NotoSans'";
	ctx.fillStyle = BLACK;
	let nextTextPositionY = 20;
	for (let routeSummary in traffic) {
		if (traffic.hasOwnProperty(routeSummary)) {
			ctx.fillText(`${routeSummary}: ${traffic[routeSummary].duration}min`, 10, nextTextPositionY);
			nextTextPositionY += 15;
		}
	}

	// Weather
	const weatherDetailsText = `(H${weather.temperature.high}/L${weather.temperature.low}/${weather.humidity}%)`;
	const weatherDetailsTextWidth = ctx.measureText(weatherDetailsText).width;
	const conditionsText = weather.conditions;
	const conditionsTextWidth = ctx.measureText(conditionsText).width;
	const tempText = `${weather.temperature.current} °C`;
	const tempTextWidth = ctx.measureText(tempText).width;

	ctx.fillStyle = BLACK;
	ctx.fillText(weatherDetailsText, displayDimX - weatherDetailsTextWidth - 5, displayDimY - 20);
	ctx.fillText(conditionsText, displayDimX - tempTextWidth - conditionsTextWidth - 10, displayDimY - 5);
	ctx.fillStyle = RED;
	ctx.fillText(tempText, displayDimX - tempTextWidth - 5, displayDimY - 5);

	/*
		Transfer canvas pixels to inky pixels
	*/
	const canvasPixels = ctx.getImageData(0, 0, displayDimX, displayDimY).data;

	let posX = 0;
	let posY = displayDimY; // Y axis needs to be mirrored. Maybe because of the inkyphat library
	for (let i = 0; i < canvasPixels.length; i+=4) {
		const r = canvasPixels[i];
		const g = canvasPixels[i + 1];
		const b = canvasPixels[i + 2];

		let color;
		if (r > 100 && g < 100 && b < 100) {
			color = inkyphat.RED;
		} else if (r > 100 || g > 100 || b > 100) {
			color = inkyphat.WHITE;
		} else {
			color = inkyphat.BLACK;
		}
		inkyphat.setPixel(posX, posY, color);
		posX++;
		if (posX >= displayDimX) {
			posX = 0;
			posY--;
			if (posY < 0 && i !== canvasPixels.length) {
				throw new Error(`Y-position out of bounds: ${posX}x${posY}`);
			}
		}
	}
	console.log("Drawing...");
	await inkyphat.redraw();

	if (config.simulation) {
		const simCanvas = createCanvas(displayDimX, displayDimY);
		const simCtx = simCanvas.getContext("2d");
		for (let j = 0; j < inkyphat.pixels.length; j++) {
			const {x, y, fillStyle} = inkyphat.pixels[j];
			simCtx.fillStyle = fillStyle;
			simCtx.fillRect(x, y, 1, 1);
		}
		await writeImage(simCanvas);
	}
}

function loadFont() {
	return new Promise((resolve, reject) => {
		registerFont("node_modules/notosans-fontface/fonts/NotoSans-Regular.ttf", {family: "NotoSans"});
		resolve();
	});
}

async function writeImage(display) {
	return new Promise((resolve, reject) => {
		const fs = require("fs");
		const out = fs.createWriteStream(__dirname + "/out.png");
		const stream = display.pngStream();

		stream.on("data", function(chunk) {
			out.write(chunk);
		});

		stream.on("end", function() {
			console.log("out.png written");
			resolve();
		});
	});
}
