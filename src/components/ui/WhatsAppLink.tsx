import { DEFAULT_WHATSAPP_MESSAGE, whatsappLink } from "@/config/site";

/**
 * Opens the official SKOLAR WhatsApp chat. Until NEXT_PUBLIC_WHATSAPP_NUMBER
 * is configured, it falls back to the contact section instead of guessing a number.
 */
export function WhatsAppLink({
  message = DEFAULT_WHATSAPP_MESSAGE,
  className,
  children,
  ...rest
}: { message?: string; className?: string; children: React.ReactNode } & Omit<
  React.AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
>) {
  const href = whatsappLink(message);
  if (!href) {
    return (
      <a href="/#contact" className={className} data-whatsapp-unconfigured="" {...rest}>
        {children}
      </a>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className} {...rest}>
      {children}
    </a>
  );
}
