export const requestLogger=(req,res,next)=>{
    console.log("Request Reciveed")
    const start=process.hrtime.bigint();
    res.on("finish",()=>{
        const finish=process.hrtime.bigint();
        const time=Number(finish-start)/1e6
        console.log(`${req.method} ${req.originalUrl}
Status code: ${res.statusCode}
Response Time: ${time.toFixed(2)}ms`);
});
   
    next();
}