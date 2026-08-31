declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

declare module 'dsh-pro-chat/remote' {
  const descriptor: any
  export default descriptor
}
