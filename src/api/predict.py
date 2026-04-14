import sys, joblib
model = joblib.load("public/model_random_forest.joblib")
temp, hum, co2 = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3])
label = model.predict([[temp, hum, co2]])[0]
print(int(label))