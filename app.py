from flask import Flask, render_template, jsonify, request
from datetime import datetime, timedelta
import requests, json

app = Flask(__name__)

API_KEY = "YOUR_API_KEY_HERE"

# → TomTom API key for route planner
TOMTOM_API_KEY = "YOUR_API_KEY_HERE"


# Load train data
with open("data/train_routes.json", "r") as f:
    TRAIN_DATA = json.load(f)

# Load bus data
with open("data/bus_routes.json", "r") as f:
    BUS_DATA = json.load(f)


@app.route("/")
def home():
    return render_template("index.html")


# ================== TRAIN ENDPOINT ==================
@app.route("/train/<train_no>")
def get_train_status(train_no):
    # Try API first
    url = (
       #YOUR_API_URL_HERE
    )

    try:
        res = requests.get(url, timeout=8)
        res.raise_for_status()
        data = res.json()
        if data.get("records"):
            return jsonify({"data": data["records"]})
    except:
        pass

    train = TRAIN_DATA.get(train_no)
    if not train:
        return jsonify({"error": "Train not found"}), 404

    stations = train["stations"]
    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    for i in range(len(stations) - 1):
        dep_time = stations[i].get("dep", "").strip()
        arr_time = stations[i+1].get("arr", "").strip()
        if dep_time.lower() in ["starts", "end", ""]:
            continue
        
        try:
            dep = datetime.strptime(dep_time, "%H:%M").replace(
                year=today.year, month=today.month, day=today.day
            )
            arr = datetime.strptime(arr_time, "%H:%M").replace(
                year=today.year, month=today.month, day=today.day
            )
            if arr < dep:
                arr += timedelta(days=1)
        except:
            continue
        
        if dep <= now <= arr:
            progress = (now - dep).total_seconds() / (arr - dep).total_seconds()
            progress = max(0, min(1, progress))

            lat = stations[i]["lat"] + (stations[i+1]["lat"] - stations[i]["lat"]) * progress
            lng = stations[i]["lng"] + (stations[i+1]["lng"] - stations[i]["lng"]) * progress

            return jsonify({
                "train_no": train_no,
                "train_name": train["name"],
                "from": stations[i]["name"],
                "to": stations[i+1]["name"],
                "progress": round(progress * 100, 1),
                "lat": lat,
                "lng": lng
            })

    return jsonify({
        "train_no": train_no,
        "train_name": train["name"],
        "status": "halted or completed",
        "lat": stations[-1]["lat"],
        "lng": stations[-1]["lng"]
    })


# ================== BUS ENDPOINT ==================
@app.route("/bus/<plate>")
def get_bus_status(plate):
    # Find bus by number plate
    bus = None
    for key, data in BUS_DATA.items():
        if data["number_plate"].lower() == plate.lower():
            bus = data
            break

    if not bus:
        return jsonify({"error": "Bus not found"}), 404

    stops = bus["stops"]
    if len(stops) < 2:
        return jsonify({"error": "Not enough stops to simulate"}), 400

    now = datetime.now()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    for i in range(len(stops) - 1):
        try:
            t1 = datetime.strptime(stops[i]["time"], "%H:%M").replace(
                year=today.year, month=today.month, day=today.day
            )
            t2 = datetime.strptime(stops[i+1]["time"], "%H:%M").replace(
                year=today.year, month=today.month, day=today.day
            )
            if t2 < t1:
                t2 += timedelta(days=1)
        except:
            continue

        if t1 <= now <= t2:
            progress = (now - t1).total_seconds() / (t2 - t1).total_seconds()
            progress = max(0, min(1, progress))

            lat = stops[i]["lat"] + (stops[i+1]["lat"] - stops[i]["lat"]) * progress
            lng = stops[i]["lng"] + (stops[i+1]["lng"] - stops[i]["lng"]) * progress

            return jsonify({
                "bus_name": bus["name"],
                "number_plate": bus["number_plate"],
                "bus_type": bus.get("bus_type"),
                "from": stops[i]["name"],
                "to": stops[i+1]["name"],
                "progress": round(progress * 100, 1),
                "lat": lat,
                "lng": lng
            })

    return jsonify({
        "bus_name": bus["name"],
        "number_plate": bus["number_plate"],
        "bus_type": bus.get("bus_type"),
        "status": "not running at this time",
        "lat": stops[-1]["lat"],
        "lng": stops[-1]["lng"]
    })


# ================================================================
#  🔥 NEW: ROUTE PLANNER — TOMTOM SEARCH API
# ================================================================
@app.route("/api/search")
def api_search():
    q = request.args.get("q")
    if not q:
        return jsonify({"results": []})

    url = (
        #YOUR_API_URL_HERE
    )

    try:
        r = requests.get(url, timeout=5).json()
    except:
        return jsonify({"results": []})

    results = []
    for item in r.get("results", []):
        pos = item.get("position")
        if not pos:
            continue
        results.append({
            "display": item.get("address", {}).get("freeformAddress", q),
            "position": {"lat": pos["lat"], "lon": pos["lon"]}
        })

    return jsonify({"results": results})


# ================================================================
#  🔥 NEW: ROUTE PLANNER — TOMTOM ROUTING API
# ================================================================
@app.route("/api/route")
def api_route():
    fromLat = request.args.get("fromLat")
    fromLng = request.args.get("fromLng")
    toLat = request.args.get("toLat")
    toLng = request.args.get("toLng")

    if not all([fromLat, fromLng, toLat, toLng]):
        return jsonify({"error": "Missing parameters"}), 400

    url = (
        #YOUR_API_URL_HERE
    )
    try:
        r = requests.get(url, timeout=5).json()
    except:
        return jsonify({"error": "Route API failed"}), 500

    route = r["routes"][0]
    coords = [[p["latitude"], p["longitude"]] for p in route["legs"][0]["points"]]

    summary = route.get("summary", {})
    distanceKm = summary.get("lengthInMeters", 0) / 1000
    travelTimeSec = summary.get("travelTimeInSeconds", 0)
    delaySec = summary.get("trafficDelayInSeconds", 0)

    return jsonify({
        "coords": coords,
        "distanceKm": distanceKm,
        "travelTimeSec": travelTimeSec,
        "trafficDelaySec": delaySec
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
