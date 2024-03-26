

const cookie = require('cookie');
const jwt = require('jsonwebtoken')

 const JWT_Verify=async(req,res,next)=>{
    try {
        const cookies = cookie.parse(req.headers.cookie || '');

        // Retrieve the NextAuth token from the cookies
        const nextAuthToken = cookies['next-auth.session-token'];
    
        const verifiedToken = await verifyAndDecodeToken(nextAuthToken)
        if(verifiedToken.user && verifiedToken.user.id){
            req.body.user=verifiedToken.user
            next()
        }else{
            return res.status(401).json({message:"User Unauthorized"})
        }
        
    } catch (error) {
        return res.status(401).json({error:error})
    }
}


const verifyAndDecodeToken = async(token) => {
    try {
        // Verify the token against the NextAuth secret key
       
        let verifiedToken= await jwt.verify(token,"bednipxw5Nepcvw6uajz0FqWq9hDeHrAmc8ffkOMJt0=")
        if(verifiedToken==null || undefined) return null
        return verifiedToken
    } catch (error) {
        // Handle verification errors (e.g., invalid token, expired token)
        console.error('Token verification failed:', error);
        return null;
    }
};


module.exports={JWT_Verify}