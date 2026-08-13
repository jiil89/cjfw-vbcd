// pg Pool — config.databaseUrl 하나로만 연결한다.
//
// 지금은 로컬 Postgres(5432)를 가리키지만, 나중에 Supabase 커넥션 풀러(6543,
// transaction 모드/Supavisor)로 바뀔 것을 전제로 이 파일에는 호스트/포트에 대한
// 가정을 넣지 않는다 — 연결 문자열(config.databaseUrl)을 그대로 사용할 뿐이다.

import { Pool } from "pg";
import { config } from "../config/env";

export const pool = new Pool({
  connectionString: config.databaseUrl,
});
