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
- `components/AtsCvBuilder.jsx` — مكوّن نموذج/معاينة السيرة الذاتية.
- `lib/pdfText.js`, `lib/cvPdfLayout.js`, `lib/arabicShape.js` — توليد PDF كنص عربي حقيقي قابل للتحديد والبحث (متوافق مع ATS)، بخط Amiri المُدمَج.
- `public/fonts/` — خط Amiri (رخصة SIL Open Font License) مُستخدَم لتضمينه داخل ملف الـ PDF.
