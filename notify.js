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
  if (!(item.startDate || item.lastDone)) return "normal"; // 日付がない古いデータは通常扱い
  const base = parse(item.startDate || item.lastDone);
  if (item.cycleUnit === "f" || item.cycleUnit === "fy") {
    // 毎月・毎年：実施日に関係なく、決まった日が期日になる
    const next = (after) => item.cycleUnit === "fy"
      ? nextYearlyUTC(after, item.cycleMonth, item.cycleCount)
      : nextFixed(after, item.cycleCount);
    // 期日を先に済ませたときは、アプリ側で計測開始日がその期日になっている
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

// 日本時間の「時」（0〜23）
function hourJST() {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo", hour: "numeric", hourCycle: "h23"
  }).format(new Date()));
}

// 送信結果から、無効になった端末の登録を集める
function collectDead(res, tokens, dead) {
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (!r.success && (code === "messaging/registration-token-not-registered" ||
                       code === "messaging/invalid-registration-token")) {
      dead.add(tokens[i]);
    }
  });
}

// 夜：まだ残っている「やばい」「そろそろ」の項目を、1通にまとめて知らせる
async function sendSummary(itemsSnap, tokens, t, dead) {
  const groups = { danger: [], soon: [] };
  for (const doc of itemsSnap.docs) {
    try {
      const it = doc.data();
      const key = judge(it, t);
      if (groups[key]) groups[key].push(it.name);
    } catch (err) {
      console.error(`項目 ${doc.id} でエラー:`, err);
    }
  }
  const total = groups.danger.length + groups.soon.length;
  if (!total || !tokens.length) return 0;
  const parts = [];
  if (groups.danger.length) parts.push(`やばい：${groups.danger.join("、")}`);
  if (groups.soon.length) parts.push(`そろそろ：${groups.soon.join("、")}`);
  let body = parts.join("\n");
  if (body.length > 150) body = body.slice(0, 149) + "…";
  const res = await messaging.sendEachForMulticast({
    tokens,
    data: { title: `残っているやること ${total}件`, body, url: APP_URL, badge: String(total) }
  });
  collectDead(res, tokens, dead);
  return res.successCount;
}

async function main() {
  const t = todayJST();
  const itemsSnap = await db.collection("housework_items").get();
  const devSnap = await db.collection("housework_devices").get();
  const tokens = devSnap.docs.map(d => d.data().token).filter(Boolean);
  let sent = 0;
  const dead = new Set(); // 無効になった端末の登録

  // ホーム画面のアイコンに出す件数（「そろそろ」「やばい」の合計。一時停止中は数えない）
  let badgeCount = 0;
  for (const doc of itemsSnap.docs) {
    try {
      const key = judge(doc.data(), t);
      if (key === "danger" || key === "soon") badgeCount++;
    } catch (err) {
      console.error(`項目 ${doc.id} でエラー:`, err);
    }
  }

  // 午後（夜8時の回）は、まとめの通知だけを送る。朝の回は、状態が変わった項目を1件ずつ知らせる
  if (hourJST() >= 15) {
    sent = await sendSummary(itemsSnap, tokens, t, dead);
    await Promise.all([...dead].map(tk => db.collection("housework_devices").doc(tk).delete()));
    console.log(`まとめの通知を送った数: ${sent}`);
    return;
  }

  for (const doc of itemsSnap.docs) {
    // 1件でエラーが出ても、ほかの項目の通知は続ける
    try {
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
            title: it.name,
            body: `${LABEL[key]}になりました`,
            url: APP_URL,
            badge: String(badgeCount)
          }
        });
        sent += res.successCount;
        ok = res.successCount;

        // 無効になった端末の登録は削除する
        collectDead(res, tokens, dead);
      }

      // 知らせた状態を保存して、次回の重複を防ぐ
      if (ok > 0) await doc.ref.update({ notifiedKey: key });
    } catch (err) {
      console.error(`項目 ${doc.id} でエラー:`, err);
    }
  }

  // 無効になった端末の登録を、最後まで消し終えてから終わる
  await Promise.all([...dead].map(t => db.collection("housework_devices").doc(t).delete()));
  console.log(`送信した通知の数: ${sent}`);
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
