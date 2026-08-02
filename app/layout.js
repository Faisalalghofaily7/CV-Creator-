export const metadata = {
  title: "منشئ السيرة الذاتية — ATS",
  description: "أنشئ سيرة ذاتية متوافقة مع أنظمة التوظيف (ATS) وحمّلها بصيغة PDF مباشرة من متصفحك.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
