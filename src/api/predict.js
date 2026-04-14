import { execSync } from "child_process";
export default function handler(req, res) {
  const { temp, hum, co2 } = req.body;
  // panggil Python script yang load .joblib dan predict
  const result = execSync(`python3 predict.py ${temp} ${hum} ${co2}`)
    .toString()
    .trim();
  res.json({ label: parseInt(result) });
}
