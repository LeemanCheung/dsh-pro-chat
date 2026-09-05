declare module '*.module.css' {
  export const cssText: string
  export const styleId: string
  const classes: Record<string, string>
  export default classes
}

declare module 'dsh-pro-chat/remote' {
  const descriptor: any
  export default descriptor
}
