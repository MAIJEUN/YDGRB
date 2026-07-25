import { existsSync } from "node:fs";
import path from "node:path";

// Node 22 에 내장된 .env 로더를 쓴다 (dotenv 패키지 불필요).
// 실행할 때 --env-file 플래그를 붙이지 않아도 되도록 여기서 직접 읽는다.
// 이 모듈은 "부수효과 전용"이다 — process.env 를 읽는 모듈은 반드시 이걸 먼저 import 해야 한다.
const envPath = path.resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
