# CV Creator — منشئ السيرة الذاتية (ATS)

تطبيق Next.js لإنشاء سيرة ذاتية بالعربية متوافقة مع أنظمة تتبع المتقدمين (ATS)، وتحميلها كملف PDF مباشرة من المتصفح دون إرسال أي بيانات لأي خادم.

## التشغيل محليًا

```bash
npm install
npm run dev
```

ثم افتح `http://localhost:3000`.

## البنية

- `app/` — صفحات Next.js (App Router).
- `components/AtsCvBuilder.jsx` — مكوّن نموذج/معاينة السيرة الذاتية وتصدير PDF.
