
import GifConverter from "./components/GifConverter";

export default function Home() {
  return (
    <div className="min-h-screen bg-white dark:bg-black text-black dark:text-white pb-20">
      {/* Background decorations if we want "Rich Aesthetics" */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-purple-500/10 blur-3xl opacity-50 dark:opacity-20" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/10 blur-3xl opacity-50 dark:opacity-20" />
      </div>

      <main className="relative z-10 flex flex-col items-center justify-start pt-12 px-4 md:px-8">
        <GifConverter />
      </main>
    </div>
  );
}
