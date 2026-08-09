# CV Creator — منشئ السيرة الذاتية (ATS)

تطبيق Next.js لإنشاء سيرة ذاتية بالعربية/الإنجليزية متوافقة مع أنظمة تتبع المتقدمين (ATS)، وتحميلها كملف PDF.

## التشغيل محليًا

```bash
npm install
npm run dev
```

ثم افتح `http://localhost:3000`. يحتاج توليد الـ PDF محليًا وجود Google Chrome مثبّت على جهازك (أو مسار مخصص عبر متغير البيئة `PUPPETEER_EXECUTABLE_PATH`).

## البنية

- `app/` — صفحات Next.js (App Router).
- `app/api/generate-pdf/route.js` — نقطة نهاية (API route) تحوّل بيانات السيرة إلى HTML ثم تولّد PDF عبر متصفح Chromium حقيقي (Puppeteer)، بدلاً من رسم الحروف يدويًا. هذا يضمن أن يكون التشكيل العربي والاتجاه (RTL/LTR) والنص المُخزَّن داخل الملف صحيحًا وقابلاً للنسخ والبحث فعليًا (متوافق مع ATS)، لأن Chromium يتولى تشكيل العربي والـ bidi أصلياً.
- `components/AtsCvBuilder.jsx` — مكوّن نموذج/معاينة السيرة الذاتية. زر "تحميل PDF" يرسل بيانات السيرة إلى `/api/generate-pdf` ويُنزّل الملف الناتج.
- `lib/cvHtmlTemplate.js` — يبني قالب الـ HTML للسيرة الذاتية (نفس المحتوى في الحالتين العربية والإنجليزية).
- `lib/cvLabels.js` — عناوين الأقسام بالعربية والإنجليزية (مشتركة بين المعاينة وملف الـ PDF).
- `lib/cvFontData.js` — خط Tajawal (رخصة SIL Open Font License) مُضمَّن كـ base64 داخل قالب الـ HTML.
- `lib/db.js` — عميل قاعدة البيانات (Neon serverless driver)، يُستخدم فقط من نقاط النهاية (API routes) على الخادم.
- `lib/blob.js` و`lib/cvArchive.js` — رفع ملف الـ PDF المولَّد إلى Vercel Blob (خاص) وربطه بسجل كود الدخول في قاعدة البيانات؛ يُستخدمان فقط من `app/api/generate-pdf/route.js` على الخادم.
- `app/api/admin/codes/route.js` و`app/api/admin/codes/[id]/route.js` — عرض/إنشاء/تعديل أكواد الدخول (لوحة المشرف).
- `app/api/access/redeem/route.js` — التحقق من كود الدخول عند بوابة المستخدم فقط (لا يُحوَّل الكود إلى "مستخدَم" هنا).
- `lib/userSession.js` — إدارة جلسة المستخدم (جدول `user_sessions`) التي تتذكّر الكود المُتحقَّق منه عبر تحديث الصفحة، قبل أن يُستهلَك الكود فعليًا.
- `app/api/admin/cvs/route.js` — قائمة أرشيف السير الذاتية (يدعم `?status=` للتصفية حسب حالة الإرسال). `app/api/admin/cvs/[id]/pdf/route.js` — يجلب الملف الخاص من Blob ويُعيد بثّه للمتصفح، فلا يُكشف رابط Blob أو التوكن مطلقًا. `app/api/admin/cvs/[id]/status/route.js` — تحديث حالة الإرسال (ويُضيف سطرًا لسجل `sending_status_history`). `app/api/admin/cvs/[id]/history/route.js` — سجل تغييرات الحالة لسجل واحد.
- `lib/sendingStatus.js` — قائمة حالات الإرسال الأربع وتسمياتها وألوانها بالعربية، مشتركة بين نقاط النهاية (للتحقق) ولوحة المشرف (للعرض).
- `lib/adminAuth.js` — التحقق من بيانات المشرف (bcrypt) وإدارة جلسات تسجيل الدخول (جدول `admin_sessions`)؛ يُستخدم فقط على الخادم.
- `app/api/admin/login/route.js` و`app/api/admin/logout/route.js` — تسجيل الدخول/الخروج؛ عند النجاح يُنشئ جلسة في قاعدة البيانات ويضبط كوكي `admin_session` (httpOnly + secure في الإنتاج).
- `app/admin/page.js` و`app/admin/login/page.js` — مكوّنات خادم (Server Components) تتحقق من الجلسة قبل العرض وتُعيد التوجيه لصفحة الدخول عند عدم وجود جلسة صالحة.
- `components/AdminCodes.jsx` — لوحة المشرف نفسها (تبويب الأكواد + تبويب أرشيف السير الذاتية) — لا تحتوي أي منطق تسجيل دخول، فقط تعرض البيانات وتُعيد التوجيه لصفحة الدخول إذا انتهت الجلسة (استجابة 401).
- `components/AdminLogin.jsx` — نموذج تسجيل الدخول، يرسل البيانات إلى `/api/admin/login` فقط (لا بيانات دخول مكتوبة في الكود).
- `components/AccessGate.jsx` — بوابة دخول المستخدم، تتحقق من الكود عبر `/api/access/redeem`.

## النشر على Vercel

يستخدم توليد الـ PDF في بيئة الإنتاج حزمة `@sparticuz/chromium` (متوافقة مع Vercel Serverless) — لا حاجة لأي إعداد إضافي، فقط انشر المشروع عاديًا.

## قاعدة البيانات، والتخزين، ونظام أكواد الدخول

يستخدم المشروع Neon Postgres (متصلة عبر Vercel، حزمة `@neondatabase/serverless`) لتخزين أكواد الدخول، و Vercel Blob (مخزن خاص "generated-cvs"، حزمة `@vercel/blob`) لتخزين ملفات الـ PDF المولَّدة فعليًا. تُخزَّن في قاعدة البيانات البيانات الوصفية فقط (اسم الملف/مرجعه، اللغة، اسم المتقدم، وقت الإنشاء) — أما ملف الـ PDF نفسه فيبقى في Blob، ولأن المخزن **خاص (Private)**، لا يُقرأ إلا عبر نقطة نهاية على الخادم تستخدم رمز الوصول (token)، ولا يُكشف أي رابط أو توكن للمتصفح مطلقًا.

### الإعداد المحلي

```bash
npm install
vercel env pull .env.development.local   # يجلب DATABASE_URL وBLOB_READ_WRITE_TOKEN وباقي المتغيرات من مشروع Vercel
```

### إنشاء/تحديث الجدول (آمن للتكرار)

الطريقة الأسهل — بدون طرفية على جهازك:

1. افتح لوحة تحكم Vercel → المشروع → تبويب **Storage** → قاعدة البيانات `neon-coquelicot-battery` → **Open in Neon Console** (أو من لوحة Neon مباشرة) → **SQL Editor**.
2. تأكد أن مفتاح **Read-only** في أعلى المحرر **مطفأ** (Off) — تفعيله يمنع تنفيذ أوامر الكتابة مثل `CREATE`/`ALTER`.
3. الصق محتوى `scripts/schema.sql` التالي ونفّذه:

```sql
CREATE TABLE IF NOT EXISTS access_codes (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  salla_order_number TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'used')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);

-- أرشيف السير الذاتية المولَّدة (يُشير pdf_url إلى مسار الملف الخاص في Blob، وليس رابطًا عامًا قابلاً للفتح مباشرة)
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pdf_url TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS pdf_language TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_name TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;

-- بيانات المتقدم الكاملة (لعرضها في لوحة المشرف — applicant_target_role لا تظهر أبدًا في ملف الـ PDF نفسه)
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_email TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_phone TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_city TEXT;
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS applicant_target_role TEXT;

-- حالة إرسال السيرة الذاتية للشركات (تُحدَّثها لوحة المشرف)
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS sending_status TEXT NOT NULL DEFAULT 'pending'
  CHECK (sending_status IN ('pending', 'in_progress', 'on_hold', 'sent'));

-- سجل زمني لكل تغيير في حالة الإرسال
CREATE TABLE IF NOT EXISTS sending_status_history (
  id SERIAL PRIMARY KEY,
  access_code_id INTEGER NOT NULL REFERENCES access_codes(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sending_status_history_access_code_id_idx ON sending_status_history (access_code_id);

-- جلسات تسجيل دخول المشرف
CREATE TABLE IF NOT EXISTS admin_sessions (
  token TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

-- جلسات المستخدم: تسمح لمن تحقّق من كوده عند البوابة بمتابعة تعبئة النموذج
-- بعد تحديث الصفحة دون إعادة إدخال الكود. الكود نفسه يبقى "متاحًا" (غير
-- مُستهلَك) حتى يُصدَّر ملف PDF بنجاح فعليًا — راجع /api/generate-pdf.
CREATE TABLE IF NOT EXISTS user_sessions (
  token TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
```

أو، إذا كنت تفضّل الطرفية على جهازك بعد سحب المتغيرات:

```bash
node --env-file=.env.development.local scripts/init-db.mjs
```

الأمر آمن للتكرار (`IF NOT EXISTS`) — تشغيله أكثر من مرة، حتى بعد أن يكون الجدول موجودًا بالفعل، لا يضر ويضيف فقط الأعمدة الناقصة إن وُجدت.

### متى يُصبح الكود "مُستخدَمًا"

الكود **لا** يُستهلَك عند إدخاله في بوابة الدخول — تلك الخطوة تتحقق فقط من صلاحيته وتُبقيه "متاحًا"، وتُنشئ جلسة مستخدم (كوكي `cv_session`، جدول `user_sessions`) حتى لا يُطلب من المستخدم إعادة إدخاله لو حدّث الصفحة أثناء تعبئة النموذج أو المعاينة. الكود يتحوّل إلى "مستخدَم" (`status='used'`) فقط بعد نجاح توليد ملف الـ PDF فعليًا داخل `/api/generate-pdf` — عبر تحديث شرطي ذرّي واحد (`UPDATE ... WHERE status = 'available'`) يمنع استخدام نفس الكود مرتين حتى مع طلبات متزامنة. لو فشل التوليد (خطأ شبكة/خادم) قبل هذه النقطة، يبقى الكود "متاحًا" ويمكن للمستخدم إعادة المحاولة بلا خسارة لكوده. بمجرد الاستهلاك، تُحذف جلسة المستخدم المرتبطة به وتُمسح الكوكي، فأي تحديث لاحق للصفحة يعيد المستخدم إلى بوابة الدخول ويتطلب كودًا جديدًا.

### أرشيف السير الذاتية

عند تحميل المستخدم لسيرته الذاتية (`/api/generate-pdf`)، يحاول الخادم أيضًا رفع نسخة من الملف إلى Blob وربطها بسجل الكود المستخدم في قاعدة البيانات (مع بيانات المتقدم: الاسم، البريد، الجوال، المدينة، الوظيفة المستهدفة) — هذا يحدث في الخلفية بعد توليد الملف واستهلاك الكود مباشرة وقبل إرساله للمتصفح، ولا يمكن أن يمنع المستخدم من الحصول على ملفه: أي خطأ في الرفع أو الحفظ يُسجَّل في السجلات (logs) فقط ولا يُعاد للمستخدم كخطأ.

لوحة المشرف تعرض هذا الأرشيف في تبويب "أرشيف السير الذاتية" كبطاقات (متوافقة مع الجوال) تُظهر كل بيانات المتقدم — بما فيها **الوظيفة المستهدفة**، والتي لا تظهر أبدًا داخل ملف الـ PDF نفسه لكنها ضرورية للفريق ليعرف نوع الشركات المناسبة لإرسال السيرة إليها. زر "عرض / تحميل" يفتح الملف عبر نقطة نهاية على الخادم تجلبه من Blob الخاص وتبثّه للمتصفح مباشرة.

لكل سجل **حالة إرسال** (`sending_status`) بأربع حالات: بانتظار الإرسال (الافتراضية عند إنشاء السجل) → قيد التنفيذ → معلّق / تم الإرسال. يمكن للمشرف أو الموظف تغييرها من قائمة منسدلة على البطاقة (`PATCH /api/admin/cvs/[id]/status`)، والأرشيف قابل للتصفية حسب الحالة (`GET /api/admin/cvs?status=...`). كل تغيير يُسجَّل بختم زمني واسم الحساب الذي غيّره (`admin` أو `staff`، بحسب دور الجلسة) في جدول `sending_status_history`، ويظهر كسجل زمني قابل للطي أسفل كل بطاقة (`GET /api/admin/cvs/[id]/history`). الأرشيف نفسه بطاقات متجاوبة تمامًا مع الجوال — لا حاجة للتمرير الأفقي لرؤية أي حقل.

### تسجيل دخول المشرف (آمن) — ودورا الوصول: مشرف وموظف

تسجيل الدخول حقيقي بالكامل: اسم المستخدم وكلمة المرور (كـ **هاش bcrypt**، وليس نصًا صريحًا) يُقرآن من متغيرات بيئة على الخادم فقط، والتحقق يتم في نقطة نهاية خادم (`/api/admin/login`)، وعند النجاح تُنشأ جلسة (سجل في جدول `admin_sessions` + كوكي `admin_session` بخصائص `httpOnly` و`Secure` في الإنتاج، تنتهي صلاحيتها تلقائيًا بعد 4 ساعات). صفحة `/admin` وكل نقاط نهاية المشرف تتحقق من هذه الجلسة على الخادم قبل إرجاع أي بيانات — بدون جلسة صالحة تُعاد التوجيه إلى `/admin/login` (أو خطأ 401 لنقاط الـ API).

يوجد حسابان مستقلان اختياريان لكل منهما **دور** مختلف يُحدَّد عند تسجيل الدخول حسب أي بيانات دخول تطابقت:

- **مشرف (`admin`)** — وصول كامل: توليد/عرض/تعديل أكواد الطلبات (تبويب "الأكواد") + أرشيف السير الذاتية بالكامل.
- **موظف (`staff`)** — وصول لأرشيف السير الذاتية فقط (عرض البيانات، تحميل الملفات، تغيير حالة الإرسال، عرض السجل الزمني). تبويب "الأكواد" لا يظهر له في الواجهة أصلًا، وأهم من ذلك: نقاط النهاية `/api/admin/codes` و`/api/admin/codes/[id]` **مرفوضة على مستوى الخادم** (خطأ 403) لأي جلسة دورها `staff` — هذا الفصل ليس مجرد إخفاء في الواجهة، حتى لو استُدعيت نقطة النهاية مباشرة.

**لا يوجد أي اسم مستخدم أو كلمة مرور مكتوبة في الكود** — كل شيء عبر متغيرات البيئة أدناه.

#### 1) توليد هاش كلمة المرور

كلمة المرور نفسها لا تُكتب أبدًا في أي ملف أو تُرسل لأي جهة — فقط الهاش الناتج. شغّل هذا الأمر على جهازك واكتب كلمة المرور عندما يُطلب منك (لن تظهر أثناء الكتابة):

```bash
node scripts/hash-password.mjs
```

سيطبع سطرًا مثل:

```
ADMIN_PASSWORD_HASH=$2b$12$........................................
```

نفس الأمر (`node scripts/hash-password.mjs`) يُستخدم لتوليد هاش حساب الموظف — شغّله مرة أخرى بكلمة مرور مختلفة إن أردت إنشاء حساب موظف.

#### 2) الإعداد المحلي

أضف إلى `.env.development.local` (بجانب `DATABASE_URL` الموجود بالفعل):

```
ADMIN_USERNAME=faisal
ADMIN_PASSWORD_HASH=$2b$12$........................................

# اختياري — بدونهما لا يوجد حساب موظف، ولوحة المشرف تعمل بنفس السلوك القديم
STAFF_USERNAME=staff-name
STAFF_PASSWORD_HASH=$2b$12$........................................
```

#### 3) الإعداد على Vercel

لوحة تحكم Vercel → المشروع → **Settings** → **Environment Variables** → أضف المتغيرات التالية:

| Key | Value | البيئات |
|---|---|---|
| `ADMIN_USERNAME` | `faisal` | Production, Preview, Development |
| `ADMIN_PASSWORD_HASH` | الهاش الناتج من الخطوة 1 (السطر كاملًا، يبدأ بـ `$2b$12$...`) | Production, Preview, Development |
| `STAFF_USERNAME` (اختياري) | اسم مستخدم الموظف | Production, Preview, Development |
| `STAFF_PASSWORD_HASH` (اختياري) | هاش كلمة مرور الموظف (نفس أداة التوليد) | Production, Preview, Development |

بعد الحفظ، لازم **إعادة نشر (Redeploy)** حتى تُطبَّق المتغيرات الجديدة على النشر الحالي — أسهل طريقة: من تبويب **Deployments**، افتح آخر نشر واضغط **Redeploy** (أو ادفع أي commit جديد، مثل هذا التغيير نفسه).

#### الأمان

- كلمة المرور نفسها غير مخزَّنة في أي مكان — فقط هاش bcrypt أحادي الاتجاه (لا يمكن استرجاع كلمة المرور منه).
- الجلسة عبارة عن رمز عشوائي 32-بايت غير قابل للتخمين، مخزَّن في قاعدة البيانات ومربوط بكوكي `httpOnly` (لا يمكن لأي كود JavaScript في المتصفح قراءته) و`Secure` (لا يُرسل إلا عبر HTTPS في بيئة الإنتاج) و`SameSite=Lax`.
- تسجيل الخروج يحذف سجل الجلسة من قاعدة البيانات فورًا، وليس فقط الكوكي من المتصفح.

### تكامل Claude API (بنية تحتية فقط، غير مفعّلة في أي ميزة بعد)

يستخدم المشروع `@anthropic-ai/sdk` رسميًا (`lib/anthropic.js`) لاستدعاء نموذج Claude من السيرفر فقط — المفتاح لا يصل للمتصفح أبدًا ولا يُخزَّن في الكود.

| المتغير | القيمة | البيئات |
| - | - | - |
| `ANTHROPIC_API_KEY` | مفتاح Anthropic API الخاص بك | Production, Preview, Development |

للتجربة محليًا: `vercel env pull .env.development.local` يجلب هذا المتغير مع الباقي، ثم شغّل `npm run dev` وافتح `/api/ai-test` — يجب أن يعيد `{"ok":true,"model":"claude-sonnet-5","reply":"connection OK"}`. هذا مسار اختبار اتصال فقط، وغير مربوط بعد بأي ميزة تصدير سيرة ذاتية.

### إشعار الموظف بالبريد عند وصول سيرة ذاتية جديدة (Resend)

عند أول أرشفة ناجحة لسيرة ذاتية (وليس عند إعادة التصدير)، يُرسَل بريد إلكتروني تلقائي للموظف المسؤول عبر [Resend](https://resend.com) — من السيرفر فقط، بالخلفية (`waitUntil`)، دون أي تأخير على تحميل المستخدم لملفه. فشل الإرسال (مفتاح غير صحيح، خطأ من Resend، ...) يُسجَّل في السجلات فقط ولا يوقف الأرشفة ولا التحميل.

| المتغير | القيمة | البيئات |
| - | - | - |
| `RESEND_API_KEY` | مفتاح Resend API الخاص بك | Production, Preview, Development |
| `STAFF_NOTIFICATION_EMAIL` | البريد الذي يستقبل إشعارات السير الذاتية الجديدة | Production, Preview, Development |
| `NOTIFICATION_FROM_EMAIL` (اختياري) | عنوان المرسل — الافتراضي `onboarding@resend.dev` (مرسل Resend التجريبي)، غيّره فور ربط نطاق مخصَّص بحساب Resend | Production, Preview, Development |

### تكامل Webhooks من سلة

المسار `app/api/salla-webhook` يستقبل أحداث سلة مباشرة:

- **`order.created`** — يولّد كوداً جديداً في `access_codes` (بنفس منطق توليد الكود من لوحة المشرف تماماً، عبر `lib/accessCodes.js`)، مربوطاً برقم طلب سلة (`reference_id`)، وحالته `available` — يعمل فوراً في نموذج تعبئة السيرة الذاتية تماماً كأي كود يولّده المشرف يدوياً. إن وصل نفس الطلب مرتين (سلة قد يعيد إرسال الحدث)، لا يُنشأ كود مكرر.
- **`order.status.updated`** — يسجّل حالة الطلب في سلة (`completed`, `cancelled`, ...) في عمود `salla_order_status` **الإعلامي فقط** — لا يغيّر عمود `status` (هل استُخدم الكود لإصدار سيرة ذاتية) ولا `sending_status` (هل أرسل الموظف السيرة)، لأن حالة الطلب في سلة لا تعني نفس الشيء، وربطها بها قد يمنع عميلاً دفع بالفعل من استخدام كوده.

| المتغير | القيمة | البيئات |
| - | - | - |
| `SALLA_WEBHOOK_SECRET` | السر المشترك الذي يتحقق منه هذا المسار — انظر خطوات الإعداد التي أرسلتها | Production, Preview, Development |

**التحقق من الأصالة:** يدعم المسار طريقتي التحقق التي تدعمهما سلة — **HMAC-SHA256** (رأس `x-salla-signature`) و**سر مباشر** (رأس `Authorization`، بدون أي تجزئة) — تلقائياً حسب الرأس الوارد، فيعمل أياً كانت طريقة الإرسال المتاحة لك من لوحة سلة.

**تشغيل ترحيل قاعدة البيانات:** أضِف عمود `salla_order_status` عبر تشغيل هذا السطر في محرر SQL الخاص بـ Neon (آمن للتكرار):
```sql
ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS salla_order_status TEXT;
```

## ملاحظة تقنية

تم تجربة توليد الـ PDF يدويًا (jsPDF + رسم الحروف) أولاً، لكن اتضح أن هذا النهج ينتج نصاً "يبدو صحيحاً" بصرياً لكنه يُخزَّن بترتيب غير صحيح داخل الملف، فيظهر مبعثراً عند النسخ (مشكلة توافق ATS جوهرية). التحويل إلى Puppeteer + Chromium يحل هذا جذرياً لأن المتصفح نفسه يتولى تشكيل العربي وترتيب النص المخزَّن.

مع ذلك، لوحظ أن Chromium نفسه لديه خلل معروف (غير مرتبط بالخط المستخدم) في كيفية تخزين نص الرباط الإلزامي "لا" (لام+ألف) عند التصدير كـ PDF — يظهر بصرياً بشكل صحيح، لكن عند النسخ قد يتحول أحياناً إلى "ال". تم التخفيف من هذا عبر إدراج فاصل غير مرئي (Zero-Width Non-Joiner) بين اللام والألف، مما يمنع تكوّن الرباط ويضمن ترتيب نص صحيح عند النسخ، على حساب فقدان شكل الرباط المدمج (يبقى النص مقروءاً بوضوح، فقط الحرفان منفصلان بدل الشكل المدمج التقليدي).
