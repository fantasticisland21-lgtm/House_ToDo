// 定期的に動いて、「そろそろ」「やばい」になった項目を、登録済みのiPhoneに送る
// GitHub Actionsから実行される（画面からは使わない）
const admin = require("firebase-admin");

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const messaging = admin.messaging();

const APP_URL = "https://fantasticisland21-lgtm.github.io/House_ToDo/";
const LABEL = { danger: "やばい", soon: "そろそろ" };

// 日本時間の「今日」を、日付だけ（UTCの0時）で表す
function todayJST() {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// "2026-10-01" を日付（UTCの0時）にする
function parse(s) {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

// 日・週間は日数で足す。ヶ月・年は暦の上で足し、月末は月の最終日に合わせる
function addPeriod(base, unit, count) {
  const b = new Date(base);
  if (unit === "d" || unit === "w") {
    const days = unit === "w" ? 7 * count : count;
    return Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate() + days);
  }
  const months = unit === "y" ? 12 * count : count;
  const first = new Date(Date.UTC(b.getUTCFullYear(), b.getUTCMonth() + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(b.getUTCDate(), last));
}

// 毎月○日の期日：基準日より後で、最初に来る「○日」（月末を超える日は末日にする）
function nextFixed(afterMs, day) {
  const a = new Date(afterMs);
  let y = a.getUTCFullYear();
  let m = a.getUTCMonth();
  for (let i = 0; i < 2; i++) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const cand = Date.UTC(y, m, Math.min(day, last));
    if (cand > afterMs) return cand;
    m++;
    if (m > 11) { m = 0; y++; }
  }
}

// 毎年○月○日の期日（UTC）
function nextYearlyUTC(afterMs, month, day) {
  const a = new Date(afterMs);
  for (let i = 0; i < 2; i++) {
    const y = a.getUTCFullYear() + i;
    const last = new Date(Date.UTC(y, month, 0)).getUTCDate();
    const cand = Date.UTC(y, month - 1, Math.min(day, last));
    if (cand > afterMs) return cand;
  }
}

// アプリ本体と同じ判定：1周期後で「そろそろ」、2周期後で「やばい」
function judge(item, t) {
  if (item.paused) return "paused";
  const base = parse(item.startDate || item.lastDone);
  if (item.cycleUnit === "f" || item.cycleUnit === "fy") {
    // 毎月・毎年：実施日に関係なく、決まった日が期日になる
    const next = (after) => item.cycleUnit === "fy"
      ? nextYearlyUTC(after, item.cycleMonth, item.cycleCount)
      : nextFixed(after, item.cycleCount);
    const d1 = next(base);
    const d2 = next(d1);
    if (t >= d2) return "danger";
    if (t >= d1) return "soon";
    return "normal";
  }
  const n1 = addPeriod(base, item.cycleUnit, item.cycleCount);
  const n2 = addPeriod(base, item.cycleUnit, item.cycleCount * 2);
  if (t >= n2) return "danger";
  if (t >= n1) return "soon";
  return "normal";
}

async function main() {
  const t = todayJST();
  const itemsSnap = await db.collection("housework_items").get();
  const devSnap = await db.collection("housework_devices").get();
  const tokens = devSnap.docs.map(d => d.data().token).filter(Boolean);
  let sent = 0;

  for (const doc of itemsSnap.docs) {
    const it = doc.data();
    const key = judge(it, t);
    const seen = it.notifiedKey || "normal";

    // 通常か一時停止中なら、次に変わったときに知らせられるよう印を戻す
    if (key === "normal" || key === "paused") {
      if (seen !== "normal") await doc.ref.update({ notifiedKey: "normal" });
      continue;
    }

    // 同じ状態で知らせ済みなら何もしない
    if (seen === key) continue;

    let ok = 0; // 実際に届いた数（0なら、知らせ済みにしない）
    if (tokens.length) {
      const res = await messaging.sendEachForMulticast({
        tokens,
        data: {
          title: `${key === "danger" ? "🔴" : "🟡"} ${it.name}`,
          body: `${LABEL[key]}になりました`,
          url: APP_URL
        }
      });
      sent += res.successCount;
      ok = res.successCount;

      // 無効になった端末の登録は削除する
      res.responses.forEach((r, i) => {
        const code = r.error && r.error.code;
        if (!r.success && (code === "messaging/registration-token-not-registered" ||
                           code === "messaging/invalid-registration-token")) {
          db.collection("housework_devices").doc(tokens[i]).delete();
        }
      });
    }

    // 知らせた状態を保存して、次回の重複を防ぐ
    if (ok > 0) await doc.ref.update({ notifiedKey: key });
  }
  console.log(`送信した通知の数: ${sent}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
