import * as Handler from "../src/app.mjs"
import Event from "../events/event.json" assert { type: "json" };

 
const result = await Handler.lambdaHandler(Event, null)
console.log('result', result)

