import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { pageVariants } from "@/lib/motion";

/**
 * Route içeriğini AnimatePresence ile sarar — gezinti sırasında çık/gir geçişi.
 * `mode="wait"`: önce eski sayfa çıkar, sonra yeni girer. `useOutlet()` ile
 * eşleşen alt route elementi alınır; key = pathname olduğundan her gezintide
 * AnimatePresence devreye girer.
 */
export function AnimatedOutlet() {
  const location = useLocation();
  const outlet = useOutlet();

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        variants={pageVariants}
        initial="initial"
        animate="enter"
        exit="exit"
        className="h-full"
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  );
}
